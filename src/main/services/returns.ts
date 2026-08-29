import { getDb } from '../database'
import { adjustStock } from './stock'
import { recomputeBalances } from '../repositories/customers'
import type {
  CompleteReturnInput,
  ReturnableItem,
  ReturnSummary,
  SaleForReturn,
  SaleSummary
} from '@shared/types'

interface SaleRow {
  id: number
  receipt_no: string
  customer_id: number | null
  total: number
  status: string
  created_at: number
}

interface CustomerNameRow {
  name: string
}

function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function nextReturnNo(): string {
  const db = getDb()
  const key = 'return_counter'
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  const next = (row ? parseInt(row.value, 10) : 0) + 1
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(next))
  return `I-${today().replace(/-/g, '')}-${String(next).padStart(4, '0')}`
}

/** Son satışlar (iade için kaynak seçimi). */
export function listSalesForReturn(): SaleSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.receipt_no, s.customer_id, s.total, s.status, s.created_at, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       ORDER BY s.created_at DESC LIMIT 50`
    )
    .all() as Array<SaleRow & { customer_name: string | null }>
  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receipt_no,
    createdAt: r.created_at,
    customerName: r.customer_name,
    total: r.total,
    status: r.status
  }))
}

interface SaleItemRow {
  product_id: number
  name: string
  barcode: string
  quantity: number
  unit_price: number
  discount: number
  line_total: number
}

/** İade edilebilecek ürünler (kalan miktarlarla). */
export function getSaleReturnable(saleId: number): SaleForReturn {
  const db = getDb()
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`
    )
    .get(saleId) as (SaleRow & { customer_name: string | null }) | undefined
  if (!sale) throw new Error('Satış bulunamadı')

  const items = db
    .prepare(
      `SELECT si.product_id, p.name, p.barcode, si.quantity, si.unit_price, si.discount, si.line_total,
              COALESCE((SELECT SUM(ri.quantity) FROM return_items ri
                        JOIN returns r ON r.id = ri.return_id
                        WHERE r.original_sale_id = si.sale_id AND ri.product_id = si.product_id), 0) AS returned_qty
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ?`
    )
    .all(saleId) as Array<SaleItemRow & { returned_qty: number }>

  const returnable: ReturnableItem[] = items.map((it) => ({
    productId: it.product_id,
    name: it.name ?? 'Silinmiş ürün',
    barcode: it.barcode,
    quantity: it.quantity,
    returnedQty: it.returned_qty,
    remainingQty: Math.max(0, it.quantity - it.returned_qty),
    unitPrice: it.unit_price,
    lineTotal: it.line_total
  }))

  return {
    sale: {
      id: sale.id,
      receiptNo: sale.receipt_no,
      createdAt: sale.created_at,
      customerName: sale.customer_name,
      total: sale.total,
      status: sale.status
    },
    items: returnable
  }
}

/**
 * İADE — stok (+) otomatik, dashboard (−) veri olarak gerçekleşir.
 * Sonuç seçenekleri: borçtan düş / elden iade / karışık.
 * Aynı ürünün satılandan fazla iadesi ENGELLENİR (çift iade yok).
 */
export function completeReturn(input: CompleteReturnInput): { returnNo: string; total: number } {
  const db = getDb()

  if (!input.items.length) throw new Error('İade kalemi yok')

  const lines = input.items.map((it) => {
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('İade miktarı geçersiz')
    const unitPrice = Math.max(0, Math.round(it.unitPrice))
    return { ...it, qty, unitPrice, lineTotal: Math.round(unitPrice * qty) }
  })
  const total = lines.reduce((s, l) => s + l.lineTotal, 0)

  if (total <= 0) throw new Error('İade tutarı sıfır')

  const debt = Math.max(0, Math.round(input.settlementDebt))
  const cashBack = Math.max(0, Math.round(input.settlementCashBack))
  if (debt + cashBack !== total) {
    throw new Error('İade tutarı borçtan düş + elden iade toplamına eşit olmalı')
  }
  if (debt > 0 && input.customerId == null) {
    throw new Error('Borçtan düş için müşteri seçmeniz gerekir')
  }

  const settlementMethod =
    debt > 0 && cashBack > 0 ? 'mixed' : debt > 0 ? 'debt' : 'cash_back'

  // Satış kaynaklı iadede miktar limiti (çift iade engeli)
  if (input.originalSaleId != null) {
    const sale = db
      .prepare('SELECT id, status FROM sales WHERE id = ?')
      .get(input.originalSaleId) as { id: number; status: string } | undefined
    if (!sale) throw new Error('Satış bulunamadı')
    const returnable = getSaleReturnable(input.originalSaleId)
    for (const line of lines) {
      const item = returnable.items.find((x) => x.productId === line.productId)
      if (!item) throw new Error(`Ürün bu satışta bulunamadı (${line.productId})`)
      if (line.qty > item.remainingQty) {
        throw new Error(
          `"${item.name}" için satılandan fazla iade denendi (kalan: ${item.remainingQty})`
        )
      }
    }
  }

  const result = db.transaction(() => {
    // stok geri (+)
    for (const line of lines) {
      adjustStock(line.productId, line.qty)
    }

    const returnNo = nextReturnNo()
    const now = Date.now()

    const res = db
      .prepare(
        `INSERT INTO returns
           (return_no, original_sale_id, customer_id, total, settlement_method, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        returnNo,
        input.originalSaleId ?? null,
        input.customerId ?? null,
        total,
        settlementMethod,
        input.note?.trim() || null,
        input.createdBy,
        now
      )
    const returnId = Number(res.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO return_items (return_id, product_id, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const line of lines) {
      insertItem.run(returnId, line.productId, line.qty, line.unitPrice, line.lineTotal)
    }

    // Elden iade (cash / kart / havale) — kasa akışından düşer (cash)
    if (cashBack > 0) {
      db.prepare(
        `INSERT INTO return_payments
           (return_id, customer_id, date, amount, payment_method, kind, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'refund', ?, ?, ?)`
      ).run(
        returnId,
        input.customerId ?? null,
        today(),
        cashBack,
        input.refundMethod,
        `İade (${returnNo})`,
        input.createdBy,
        now
      )
    }

    // Borçtan düş — müşteri bakiyesi azalır (+ kayıt olarak yazılır)
    if (debt > 0 && input.customerId != null) {
      db.prepare(
        `INSERT INTO return_payments
           (return_id, customer_id, date, amount, payment_method, kind, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'debt_credit', ?, ?, ?)`
      ).run(
        returnId,
        input.customerId,
        today(),
        debt,
        input.refundMethod,
        `İade borçtan düş (${returnNo})`,
        input.createdBy,
        now
      )
      db.prepare(
        `INSERT INTO debt_movements
           (customer_id, return_id, date, amount, balance_after, source, note, created_by, created_at)
         VALUES (?, ?, ?, ?, 0, 'sale_return', ?, ?, ?)`
      ).run(
        input.customerId,
        returnId,
        today(),
        -debt,
        `İade (${returnNo})`,
        input.createdBy,
        now
      )
      recomputeBalances(input.customerId)
    }

    // Satış durumu: tamamen mi, kısmen mi iade edildi
    if (input.originalSaleId != null) {
      const returnableAfter = getSaleReturnable(input.originalSaleId)
      const anyIade = returnableAfter.items.some((x) => x.returnedQty > 0)
      const fully = returnableAfter.items.every((x) => x.remainingQty === 0)
      const status = !anyIade ? 'completed' : fully ? 'returned' : 'partially_returned'
      db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(status, input.originalSaleId)
    }

    return returnNo
  })

  const returnNo = result()
  return { returnNo, total }
}

export function listReturns(): ReturnSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT r.*, c.name AS customer_name, s.receipt_no AS receipt_no
       FROM returns r
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN sales s ON s.id = r.original_sale_id
       ORDER BY r.created_at DESC LIMIT 100`
    )
    .all() as Array<{
    id: number
    return_no: string
    created_at: number
    customer_name: string | null
    total: number
    settlement_method: 'debt' | 'cash_back' | 'mixed'
    receipt_no: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    returnNo: r.return_no,
    createdAt: r.created_at,
    customerName: r.customer_name,
    total: r.total,
    settlementMethod: r.settlement_method,
    originalReceiptNo: r.receipt_no
  }))
}