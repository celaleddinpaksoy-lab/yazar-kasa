import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, downDb, today } from './helpers'

beforeAll(async () => {
  await setupDb()
})
afterAll(async () => {
  await downDb()
})

describe('tedarikçi bakiyesi', () => {
  it('borç + ödeme: bakiye = manuel borç − ödenen', async () => {
    const { createSupplier } = await import('../src/main/repositories/suppliers')
    const { getSupplierBalance } = await import('../src/main/repositories/suppliers')
    const { addManualSupplierDebt } = await import('../src/main/repositories/suppliers')
    const { paySupplier } = await import('../src/main/repositories/suppliers')

    const s = createSupplier({ name: 'Tedarikçi A' })
    expect(getSupplierBalance(s.id)).toBe(0)

    addManualSupplierDebt(s.id, { amount: 50000, date: today(), note: 'açılış borcu' }, 1)
    expect(getSupplierBalance(s.id)).toBe(50000)

    paySupplier(s.id, { amount: 20000, date: today(), paymentMethod: 'cash', note: '' }, 1)
    expect(getSupplierBalance(s.id)).toBe(30000)

    paySupplier(s.id, { amount: 40000, date: today(), paymentMethod: 'cash', note: '' }, 1)
    expect(getSupplierBalance(s.id)).toBe(-10000)
  })

  it('tedarikçi ödemeleri listesi son ödeme üstte ve 100 ile sınırlı', async () => {
    const { createSupplier } = await import('../src/main/repositories/suppliers')
    const { addManualSupplierDebt } = await import('../src/main/repositories/suppliers')
    const { paySupplier } = await import('../src/main/repositories/suppliers')
    const { listSupplierPayments } = await import('../src/main/repositories/suppliers')

    const s = createSupplier({ name: 'Tedarikçi B' })
    addManualSupplierDebt(s.id, { amount: 100000, date: today(), note: '' }, 1)
    paySupplier(s.id, { amount: 30000, date: today(), paymentMethod: 'transfer', note: 'ilk' }, 1)
    paySupplier(s.id, { amount: 20000, date: today(), paymentMethod: 'cash', note: 'ikinci' }, 1)

    const payments = listSupplierPayments()
    expect(payments.length).toBeGreaterThanOrEqual(2)
    const mine = payments.filter((p) => p.supplierId === s.id)
    expect(mine[0].note).toBe('ikinci')
    expect(mine.length).toBe(2)
  })
})

describe('fiş arama (findSaleForReturnByReceipt)', () => {
  it('tam fiş no ile satış bulunur, varsayılan LIKE arama çalışır, olmayan null döner', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const { findSaleForReturnByReceipt } = await import('../src/main/services/returns')
    const { createTestProduct } = await import('./helpers')

    const p = await createTestProduct('Arama Ürün', { stockQty: 5, salePrice: 10000 })
    const r = completeSale({
      items: [{ productId: p.id, quantity: 2, unitPrice: 10000, discount: 0 }],
      customerId: null,
      paymentMethod: 'cash',
      amountPaid: 20000,
      totalDiscount: 0,
      createdBy: 1
    })

    const exact = findSaleForReturnByReceipt(r.receiptNo)
    expect(exact?.sale.id).toBeTruthy()
    expect(exact?.items.length).toBe(1)
    expect(exact?.items[0].remainingQty).toBe(2)

    // Fiş numarasının bir parçasıyla da bulunmalı (TAM eşleşme önceliği + LIKE fallback)
    const partial = findSaleForReturnByReceipt(r.receiptNo.slice(0, 8))
    expect(partial?.sale.receiptNo).toBe(r.receiptNo)

    expect(findSaleForReturnByReceipt('VAROLMAYAN-FİŞ-999')).toBeNull()
    expect(findSaleForReturnByReceipt('')).toBeNull()
  })
})