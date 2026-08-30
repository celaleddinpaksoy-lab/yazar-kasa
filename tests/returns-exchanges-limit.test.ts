import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, downDb, createTestProduct } from './helpers'

beforeAll(async () => {
  await setupDb()
})
afterAll(async () => {
  await downDb()
})

/**
 * ÇİFT KULLANIM ENGELİ (0.1.2'nin kritik mantığı):
 * Bir fişten iade + değişim "gelen" kalemleri ORTAK limit kullanır
 * (getSaleReturnable tek kaynak). Fişten fazlasına izin verilmemeli.
 */
describe('iade + değişim ortak limit', () => {
  async function sell(pId: number, qty: number): Promise<{ saleId: number; receiptNo: string }> {
    const { completeSale } = await import('../src/main/services/sales')
    const { findSaleForReturnByReceipt } = await import('../src/main/services/returns')
    const r = completeSale({
      items: [{ productId: pId, quantity: qty, unitPrice: 10000, discount: 0 }],
      customerId: null,
      payments: [{ method: 'cash', amount: 10000 * qty }],
      totalDiscount: 0,
      createdBy: 1
    })
    const sr = findSaleForReturnByReceipt(r.receiptNo)
    if (!sr) throw new Error('fiş bulunamadı: ' + r.receiptNo)
    return { saleId: sr.sale.id, receiptNo: r.receiptNo }
  }

  it('iade ve değişim toplamı satılan adedi aşamaz', async () => {
    const { completeReturn } = await import('../src/main/services/returns')
    const { completeExchange } = await import('../src/main/services/exchanges')
    const { getStock } = await import('../src/main/services/stock')
    const p = await createTestProduct('Takas Ürün', { stockQty: 20, salePrice: 10000 })
    const yeni = await createTestProduct('Yeni Verilen', { stockQty: 20, salePrice: 12000 })

    const { saleId } = await sell(p.id, 5)

    // 2'sini iade et → kalan 3
    completeReturn({
      originalSaleId: saleId,
      customerId: null,
      items: [{ productId: p.id, quantity: 2, unitPrice: 10000 }],
      settlementDebt: 0,
      settlementCashBack: 20000,
      refundMethod: 'cash',
      createdBy: 1
    })

    // Fişe bağlı değişimde gelen kalem 3'ü aşamaz → 4 deneme reddedilmeli
    expect(() =>
      completeExchange({
        customerId: null,
        originalSaleId: saleId,
        items: [
          { productId: p.id, quantity: 4, unitPrice: 10000, direction: 'in' },
          { productId: yeni.id, quantity: 1, unitPrice: 12000, direction: 'out' }
        ],
        differenceSettlement: 'cash',
        createdBy: 1
      })
    ).toThrow(/en fazla 3 adet/)

    // 3'ü değişimle ver → fiş tamamen kullanıldı
    completeExchange({
      customerId: null,
      originalSaleId: saleId,
      items: [
        { productId: p.id, quantity: 3, unitPrice: 10000, direction: 'in' },
        { productId: yeni.id, quantity: 3, unitPrice: 12000, direction: 'out' }
      ],
      differenceSettlement: 'cash',
      createdBy: 1
    })

    // Artık kalan 0 → ek iade reddedilmeli
    expect(() =>
      completeReturn({
        originalSaleId: saleId,
        customerId: null,
        items: [{ productId: p.id, quantity: 1, unitPrice: 10000 }],
        settlementDebt: 0,
        settlementCashBack: 10000,
        refundMethod: 'cash',
        createdBy: 1
      })
    ).toThrow(/fazla iade/i)

    // Stok doğrulaması: 20 −5 satış +2 iade +3 değişim gelen = 20; giden 20 −3 = 17
    expect(getStock(p.id)).toBe(20)
    expect(getStock(yeni.id)).toBe(17)
  })

  it('fişsiz değişim serbest kalır (originalSaleId yoksa limit uygulanmaz)', async () => {
    const { completeExchange } = await import('../src/main/services/exchanges')
    const p = await createTestProduct('Serbest Gelen', { stockQty: 10, salePrice: 9000 })
    const yeni = await createTestProduct('Serbest Giden', { stockQty: 10, salePrice: 11000 })

    const r = completeExchange({
      customerId: null,
      originalSaleId: null,
      items: [
        { productId: p.id, quantity: 10, unitPrice: 9000, direction: 'in' },
        { productId: yeni.id, quantity: 10, unitPrice: 11000, direction: 'out' }
      ],
      differenceSettlement: 'cash',
      createdBy: 1
    })
    expect(r.exchangeNo).toMatch(/^E-\d{8}-\d{4}$/)
  })
})