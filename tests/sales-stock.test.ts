import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, downDb, createTestProduct } from './helpers'

beforeAll(async () => {
  await setupDb()
})
afterAll(async () => {
  await downDb()
})

describe('satış + stok', () => {
  it('nakit satışta stok düşer ve fiş numarası F-YYYYMMDD-0001 desenindedir', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const { getStock } = await import('../src/main/services/stock')
    const p = await createTestProduct('Test Ürün', { stockQty: 5, salePrice: 10000 })

    const r = completeSale({
      items: [{ productId: p.id, quantity: 3, unitPrice: 10000, discount: 0 }],
      customerId: null,
      paymentMethod: 'cash',
      amountPaid: 30000,
      totalDiscount: 0,
      createdBy: 1
    })

    expect(r.receiptNo).toMatch(/^F-\d{8}-\d{4}$/)
    expect(r.total).toBe(30000)
    expect(getStock(p.id)).toBe(2)
  })

  it('yetersiz stokta satış reddedilir ve stok değişmez', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const { getStock } = await import('../src/main/services/stock')
    const p = await createTestProduct('Limit Ürün', { stockQty: 2, salePrice: 10000 })

    expect(() =>
      completeSale({
        items: [{ productId: p.id, quantity: 5, unitPrice: 10000, discount: 0 }],
        customerId: null,
        paymentMethod: 'cash',
        amountPaid: 50000,
        totalDiscount: 0,
        createdBy: 1
      })
    ).toThrow(/yetersiz stok/i)

    expect(getStock(p.id)).toBe(2)
  })

  it('eksik ödemede müşteri yoksa satış engellenir', async () => {
    const { completeSale } = await import('../src/main/services/sales')
    const p = await createTestProduct('Borçlu Ürün', { stockQty: 5, salePrice: 10000 })

    expect(() =>
      completeSale({
        items: [{ productId: p.id, quantity: 1, unitPrice: 10000, discount: 0 }],
        customerId: null,
        paymentMethod: 'cash',
        amountPaid: 5000,
        totalDiscount: 0,
        createdBy: 1
      })
    ).toThrow(/müşteri seçmeniz gerekir/i)
  })
})