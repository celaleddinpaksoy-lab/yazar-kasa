import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, downDb, createTestProduct } from './helpers'

beforeAll(async () => {
  await setupDb()
})
afterAll(async () => {
  await downDb()
})

async function db(): Promise<any> {
  const { getDb } = await import('../src/main/database')
  return (getDb as any)()
}

async function makeCustomer(name: string): Promise<number> {
  const { createCustomer } = await import('../src/main/repositories/customers')
  return createCustomer({ name, phone: '' }).id
}

async function saleIdOf(receiptNo: string): Promise<number> {
  const { findSaleForReturnByReceipt } = await import('../src/main/services/returns')
  const sr = findSaleForReturnByReceipt(receiptNo)
  if (!sr) throw new Error('fiş bulunamadı: ' + receiptNo)
  return sr.sale.id
}

describe('satış geçmişi + çoklu ödeme + silme geri alımı', () => {
  it('çoklu ödeme satışı ayrı farklı satırlar olarak saklanır', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const { getSaleHistoryDetail } = await import('../src/main/services/salesHistory')
    const p = await createTestProduct('Çoklu Ödeme', { stockQty: 5, salePrice: 10000 })

    const r = completeSale({
      items: [{ productId: p.id, quantity: 2, unitPrice: 10000, discount: 0 }],
      customerId: null,
      payments: [
        { method: 'cash', amount: 10000 },
        { method: 'card', amount: 10000 }
      ],
      totalDiscount: 0,
      createdBy: 1
    })

    const saleId = await saleIdOf(r.receiptNo)
    const detail = getSaleHistoryDetail(saleId)
    expect(detail.total).toBe(20000)
    expect(detail.paidAmount).toBe(20000)
    expect(detail.payments).toEqual([
      { method: 'cash', amount: 10000 },
      { method: 'card', amount: 10000 }
    ])

    const raw = await db()
    const rows = raw
      .prepare("SELECT payment_method, amount FROM sale_payments WHERE sale_id = ? AND kind='sale' ORDER BY id")
      .all(saleId)
    expect(rows).toHaveLength(2)
  })

  it('tarih senkronu: sales + sale_payments + debt_movements.created_at birlikte güncellenir', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const { updateSaleDate, getSaleHistoryDetail } = await import('../src/main/services/salesHistory')
    const p = await createTestProduct('Tarih Ürün', { stockQty: 5, salePrice: 10000 })
    const cid = await makeCustomer('Tarih Müşterisi')

    const r = completeSale({
      items: [{ productId: p.id, quantity: 1, unitPrice: 10000, discount: 0 }],
      customerId: cid,
      payments: [{ method: 'cash', amount: 5000 }], // 5000 borç
      totalDiscount: 0,
      createdBy: 1
    })
    const saleId = await saleIdOf(r.receiptNo)

    const newTs = 1700000000000
    updateSaleDate(saleId, newTs)

    const d = getSaleHistoryDetail(saleId)
    expect(d.createdAt).toBe(newTs)

    const raw = await db()
    const pay = raw
      .prepare('SELECT created_at FROM sale_payments WHERE sale_id = ? AND kind=?')
      .get(saleId, 'sale') as { created_at: number }
    expect(pay.created_at).toBe(newTs)
    const mvm = raw
      .prepare('SELECT created_at FROM debt_movements WHERE sale_id = ?')
      .get(saleId) as { created_at: number }
    expect(mvm.created_at).toBe(newTs)
  })

  it('satış silme: stok geri gelir, borç düşer, bağlı iade+değişim de geri alınır; bakiyeler tutarlı', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const { completeReturn } = await import('../src/main/services/returns')
    const { completeExchange } = await import('../src/main/services/exchanges')
    const { getStock } = await import('../src/main/services/stock')
    const { deleteSale, getSaleHistoryDetail } = await import('../src/main/services/salesHistory')
    const { getCustomerBalance, getCustomerDetail } = await import('../src/main/repositories/customers')
    const { listSalesHistory } = await import('../src/main/services/salesHistory')

    const p = await createTestProduct('Silme Ana', { stockQty: 20, salePrice: 10000 })
    const yeni = await createTestProduct('Silme Yeni', { stockQty: 10, salePrice: 12000 })
    const cid = await makeCustomer('Silme Müşterisi')

    // 5 sat, 10000 nakit öde, 40000 borç kalır
    const r = completeSale({
      items: [{ productId: p.id, quantity: 5, unitPrice: 10000, discount: 0 }],
      customerId: cid,
      payments: [{ method: 'cash', amount: 10000 }],
      totalDiscount: 0,
      createdBy: 1
    })
    const saleId = await saleIdOf(r.receiptNo)
    expect(getStock(p.id)).toBe(15)
    expect(getCustomerBalance(cid)).toBe(40000)

    // 2'sini iade et (borçtan düş), 3'ünü değişimle ver
    completeReturn({
      originalSaleId: saleId,
      customerId: cid,
      items: [{ productId: p.id, quantity: 2, unitPrice: 10000 }],
      settlementDebt: 20000,
      settlementCashBack: 0,
      refundMethod: 'cash',
      createdBy: 1
    })
    completeExchange({
      customerId: cid,
      originalSaleId: saleId,
      items: [
        { productId: p.id, quantity: 3, unitPrice: 10000, direction: 'in' },
        { productId: yeni.id, quantity: 3, unitPrice: 12000, direction: 'out' }
      ],
      differenceSettlement: 'cash', // 6000 - 30000 = -24000 müşteriye iade
      createdBy: 1
    })

    const before = getCustomerDetail(cid)
    // 40000 satış borcu − 20000 iade borçtan düş = 20000 (değişim fark iadesi borca işlenmez)
    expect(before.balance).toBe(20000)

    // Sil → tamamen geri alınmalı
    deleteSale(saleId)

    // Stok: 20 +5 satış geri −2 iade −3 değişim in +3 değişim out
    expect(getStock(p.id)).toBe(20)
    // giden geri geldi
    expect(getStock(yeni.id)).toBe(10)
    // borç sıfırlanmalı (satış borcu silindi, iade/değişim hareketleri de silindi)
    expect(getCustomerBalance(cid)).toBe(0)
    // geçmişte görünmemeli
    expect(listSalesHistory().some((s) => s.id === saleId)).toBe(false)
    // detay artık yok
    expect(() => getSaleHistoryDetail(saleId)).toThrow(/bulunamadı/i)
  })

  it('müşteri atama değişince borç yeni müşteriye taşınır', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const { updateSaleCustomer, getSaleHistoryDetail } = await import('../src/main/services/salesHistory')
    const { getCustomerBalance } = await import('../src/main/repositories/customers')
    const p = await createTestProduct('Atama Ürün', { stockQty: 5, salePrice: 10000 })
    const eski = await makeCustomer('Eski Sahip')
    const yeni = await makeCustomer('Yeni Sahip')

    const r = completeSale({
      items: [{ productId: p.id, quantity: 1, unitPrice: 10000, discount: 0 }],
      customerId: eski,
      payments: [{ method: 'cash', amount: 4000 }], // 6000 borç
      totalDiscount: 0,
      createdBy: 1
    })
    const saleId = await saleIdOf(r.receiptNo)
    expect(getCustomerBalance(eski)).toBe(6000)

    updateSaleCustomer(saleId, yeni)
    const detail = getSaleHistoryDetail(saleId)
    expect(detail.customerId).toBe(yeni)
    expect(getCustomerBalance(eski)).toBe(0)
    expect(getCustomerBalance(yeni)).toBe(6000)
  })
})
