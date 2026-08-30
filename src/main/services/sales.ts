import { getDb } from '../database'
import { adjustStock } from './stock'
import type {
  CompleteSaleInput,
  PaymentMethod,
  SaleReceipt,
  SaleReceiptItem
} from '@shared/types'

interface StockRow {
  stock_qty: number
}

interface ProductRow {
  id: number
  name: string
  barcode: string
}

function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function nextReceiptNo(): string {
  const db = getDb()
  const key = 'receipt_counter'
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  const next = (row ? parseInt(row.value, 10) : 0) + 1
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(next))
  const datePart = today().replace(/-/g, '')
  return `F-${datePart}-${String(next).padStart(4, '0')}`
}

/**
 * SATIŞ — SİSTEMİN ATOMİK KALBİ.
 * Tek transaction içinde: stok düşer + fiş yazılır + ödeme kaydı düşer +
 * (borçluysa) müşteri bakiyeye işlenir. Adımlardan biri başarısızsa HİÇBİRİ
 * uygulanmaz. Kural: eksik ödeme → müşteri seçiliyse borç, değilse hata.
 */
export function completeSale(input: CompleteSaleInput): SaleReceipt {
  const db = getDb()

  if (!input.items.length) throw new Error('Sepet boş')
  if (!input.payments?.length) throw new Error('Ödeme girilmedi')

  // Ödeme dağılımı doğrula: her kalem > 0, toplamı hesapla
  const payments = input.payments.map((p) => {
    const amount = Math.max(0, Math.round(p.amount))
    if (amount <= 0) throw new Error('Ödeme tutarı sıfırdan büyük olmalı')
    return { method: p.method, amount }
  })
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0)

  let subtotal = 0
  const lines = input.items.map((it) => {
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Ürün miktarı geçersiz')
    const unitPrice = Math.max(0, Math.round(it.unitPrice))
    const lineSubtotal = Math.round(unitPrice * qty)
    const lineDiscount = Math.min(lineSubtotal, Math.max(0, Math.round(it.discount)))
    const lineTotal = lineSubtotal - lineDiscount
    subtotal += lineTotal
    return { ...it, unitPrice, lineSubtotal, lineDiscount, lineTotal }
  })

  const totalDiscount = Math.min(subtotal, Math.max(0, Math.round(input.totalDiscount ?? 0)))
  const total = subtotal - totalDiscount
  const amountPaid = Math.min(total, paidTotal)
  const debtAmount = total - amountPaid

  if (debtAmount > 0 && input.customerId == null) {
    throw new Error('Ödeme eksik! Borç ile satış için müşteri seçmeniz gerekir.')
  }

  const complete = db.transaction(() => {
    for (const line of lines) {
      const stock = db
        .prepare('SELECT stock_qty FROM products WHERE id = ?')
        .get(line.productId) as StockRow | undefined
      if (!stock) throw new Error(`Ürün (${line.productId}) bulunamadı`)
      if (stock.stock_qty < line.quantity) {
        const p = db.prepare('SELECT name FROM products WHERE id = ?').get(line.productId) as ProductRow
        throw new Error(`Yetersiz stok: "${p.name}" (stok: ${stock.stock_qty})`)
      }
      adjustStock(line.productId, -line.quantity)
    }

    const receiptNo = nextReceiptNo()
    const now = Date.now()

    const saleRes = db
      .prepare(
        `INSERT INTO sales
           (receipt_no, customer_id, subtotal, discount_total, total, paid_amount, debt_amount,
            is_credit, status, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`
      )
      .run(
        receiptNo,
        input.customerId ?? null,
        subtotal,
        totalDiscount,
        total,
        amountPaid,
        debtAmount,
        debtAmount > 0 ? 1 : 0,
        input.note?.trim() || null,
        input.createdBy,
        now
      )
    const saleId = Number(saleRes.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const line of lines) {
      insertItem.run(saleId, line.productId, line.quantity, line.unitPrice, line.lineDiscount, line.lineTotal)
    }

    // Çoklu ödeme: her yöntem ayrı sale_payments satırı (kasa/shift/rapor bu
    // tabloyu okur → entegrasyon otomatik senkron kalır).
    const insertPayment = db.prepare(
      `INSERT INTO sale_payments (sale_id, customer_id, date, amount, payment_method, kind, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'sale', ?, ?)`
    )
    for (const p of payments) {
      insertPayment.run(saleId, input.customerId ?? null, today(), p.amount, p.method, input.createdBy, now)
    }

    if (debtAmount > 0 && input.customerId != null) {
      const balanceBefore = db
        .prepare('SELECT COALESCE(SUM(amount),0) AS t FROM debt_movements WHERE customer_id = ?')
        .get(input.customerId) as { t: number }
      const balanceAfter = balanceBefore.t + debtAmount
      db.prepare(
        `INSERT INTO debt_movements
           (customer_id, sale_id, date, amount, balance_after, source, payment_method, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?)`
      ).run(
        input.customerId,
        saleId,
        today(),
        debtAmount,
        balanceAfter,
        payments[0].method,
        `Veresiye satış (${receiptNo})`,
        input.createdBy,
        now
      )
    }

    return saleId
  })

  const saleId = complete()
  return buildReceipt(saleId)
}

function buildReceipt(saleId: number): SaleReceipt {
  const db = getDb()
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`
    )
    .get(saleId) as {
    receipt_no: string
    customer_name: string | null
    subtotal: number
    discount_total: number
    total: number
    paid_amount: number
    debt_amount: number
    is_credit: number
    created_at: number
  }

  const itemRows = db
    .prepare(
      `SELECT si.product_id, p.name, p.barcode, si.quantity, si.unit_price, si.discount, si.line_total
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ?`
    )
    .all(saleId) as Array<{
    product_id: number
    name: string | null
    barcode: string
    quantity: number
    unit_price: number
    discount: number
    line_total: number
  }>

  const payments = db
    .prepare(
      `SELECT amount, payment_method FROM sale_payments WHERE sale_id = ? AND kind = 'sale' ORDER BY id`
    )
    .all(saleId) as Array<{ amount: number; payment_method: PaymentMethod }>

  const items: SaleReceiptItem[] = itemRows.map((r) => ({
    productId: r.product_id,
    name: r.name ?? 'Silinmiş ürün',
    barcode: r.barcode,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    discount: r.discount,
    lineTotal: r.line_total
  }))

  return {
    receiptNo: sale.receipt_no,
    createdAt: sale.created_at,
    customerName: sale.customer_name,
    subtotal: sale.subtotal,
    discountTotal: sale.discount_total,
    total: sale.total,
    paidAmount: sale.paid_amount,
    debtAmount: sale.debt_amount,
    isCredit: sale.is_credit === 1,
    payments: payments.map((p) => ({ method: p.payment_method, amount: p.amount })),
    items
  }
}