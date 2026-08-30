import { getDb } from '../database'
import { adjustStock } from './stock'
import { recomputeBalances } from '../repositories/customers'
import { getSaleReturnable } from './returns'
import type {
  CompleteExchangeInput,
  ExchangeDirection,
  ExchangeSettlement,
  ExchangeSummary
} from '@shared/types'

function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function nextExchangeNo(): string {
  const db = getDb()
  const key = 'exchange_counter'
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  const next = (row ? parseInt(row.value, 10) : 0) + 1
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(next))
  return `E-${today().replace(/-/g, '')}-${String(next).padStart(4, '0')}`
}

function customerName(id: number | null): string | null {
  if (id == null) return null
  const row = getDb().prepare('SELECT name FROM customers WHERE id = ?').get(id) as
    | { name: string }
    | undefined
  return row?.name ?? null
}

/**
 * DEĞİŞİM — stok in(+) / out(−) ayrı satırlar; raporlarda ayrı "Değişim" kalemi.
 * Fark ödemesi: nakit/kart/havale/borca. En az bir in + bir out zorunlu,
 * stok çıkışı negatif stoğa engellenir, tek atomik transaction.
 */
export function completeExchange(input: CompleteExchangeInput): {
  exchangeNo: string
  totalIn: number
  totalOut: number
  difference: number
} {
  const db = getDb()

  const lines = input.items.map((it) => {
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Değişim miktarı geçersiz')
    const unitPrice = Math.max(0, Math.round(it.unitPrice))
    return { ...it, qty, unitPrice, lineTotal: Math.round(unitPrice * qty) }
  })
  const inLines = lines.filter((l) => l.direction === 'in')
  const outLines = lines.filter((l) => l.direction === 'out')
  if (inLines.length === 0) throw new Error('En az bir gelen ürün seçin (iade edilen)')
  if (outLines.length === 0) throw new Error('En az bir giden ürün seçin (yeni verilen)')

  // Fişe bağlı değişim: gelen kalemler satıştan kalan miktarı aşamaz
  // (iade + değişim ortak limit — getSaleReturnable tek kaynak).
  if (input.originalSaleId != null) {
    const src = getSaleReturnable(input.originalSaleId)
    for (const l of inLines) {
      const item = src.items.find((it) => it.productId === l.productId)
      if (item && l.qty > item.remainingQty) {
        throw new Error(
          `"${item.name}" için fişten en fazla ${item.remainingQty} adet iade edilebilir`
        )
      }
    }
  }

  const totalIn = inLines.reduce((s, l) => s + l.lineTotal, 0)
  const totalOut = outLines.reduce((s, l) => s + l.lineTotal, 0)
  const difference = totalOut - totalIn

  const settlement: ExchangeSettlement = input.differenceSettlement ?? 'none'
  if (difference !== 0 && settlement === 'none') {
    throw new Error('Fark için ödeme şekli seçmelisiniz (nakit/kart/havale/borca)')
  }
  if (settlement === 'debt' && input.customerId == null) {
    throw new Error('Borca yansıtmak için müşteri seçmeniz gerekir')
  }

  const result = db.transaction(() => {
    for (const l of lines) {
      const delta = l.direction === 'in' ? l.qty : -l.qty
      adjustStock(l.productId, delta)
    }

    const exchangeNo = nextExchangeNo()
    const now = Date.now()

    const res = db
      .prepare(
        `INSERT INTO exchanges
           (exchange_no, original_sale_id, customer_id, total_in, total_out, difference, difference_settlement, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        exchangeNo,
        input.originalSaleId ?? null,
        input.customerId ?? null,
        totalIn,
        totalOut,
        difference,
        settlement,
        input.note?.trim() || null,
        input.createdBy,
        now
      )
    const exchangeId = Number(res.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO exchange_items (exchange_id, product_id, quantity, unit_price, direction, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const l of lines) {
      insertItem.run(exchangeId, l.productId, l.qty, l.unitPrice, l.direction as ExchangeDirection, l.lineTotal)
    }

    // Fark çözümü
    if (difference > 0 && settlement !== 'debt') {
      // müşteri farkı öder → giriş
      db.prepare(
        `INSERT INTO sale_payments (customer_id, date, amount, payment_method, kind, note, created_by, created_at)
         VALUES (?, ?, ?, ?, 'exchange', ?, ?, ?)`
      ).run(
        input.customerId ?? null,
        today(),
        difference,
        settlement, // cash | card | transfer
        `Değişim (${exchangeNo})`,
        input.createdBy,
        now
      )
    } else if (difference > 0 && settlement === 'debt') {
      db.prepare(
        `INSERT INTO debt_movements
           (customer_id, date, amount, balance_after, source, payment_method, note, created_by, created_at)
         VALUES (?, ?, ?, 0, 'exchange', ?, ?, ?, ?)`
      ).run(
        input.customerId,
        today(),
        difference,
        'debt',
        `Değişim farkı (${exchangeNo})`,
        input.createdBy,
        now
      )
      recomputeBalances(input.customerId!)
    }

    if (difference < 0) {
      const amount = -difference
      if (settlement === 'debt') {
        db.prepare(
          `INSERT INTO debt_movements
             (customer_id, date, amount, balance_after, source, payment_method, note, created_by, created_at)
           VALUES (?, ?, ?, 0, 'exchange', ?, ?, ?, ?)`
        ).run(
          input.customerId,
          today(),
          -amount,
          'debt',
          `Değişim farkı iadesi (${exchangeNo})`,
          input.createdBy,
          now
        )
        recomputeBalances(input.customerId!)
      } else {
        db.prepare(
          `INSERT INTO return_payments
             (return_id, customer_id, date, amount, payment_method, kind, note, created_by, created_at)
           VALUES (NULL, ?, ?, ?, ?, 'refund', ?, ?, ?)`
        ).run(
          input.customerId ?? null,
          today(),
          amount,
          settlement, // cash | card | transfer
          `Değişim fark iadesi (${exchangeNo})`,
          input.createdBy,
          now
        )
      }
    }

    return exchangeNo
  })

  const exchangeNo = result()
  return { exchangeNo, totalIn, totalOut, difference }
}

export function listExchanges(): ExchangeSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT e.*, s.receipt_no AS original_receipt_no
       FROM exchanges e
       LEFT JOIN sales s ON s.id = e.original_sale_id
       ORDER BY e.created_at DESC LIMIT 100`
    )
    .all() as Array<{
    id: number
    exchange_no: string
    created_at: number
    customer_id: number | null
    original_sale_id: number | null
    original_receipt_no: string | null
    total_in: number
    total_out: number
    difference: number
    difference_settlement: ExchangeSettlement
    note: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    exchangeNo: r.exchange_no,
    createdAt: r.created_at,
    customerName: customerName(r.customer_id),
    originalSaleId: r.original_sale_id,
    originalReceiptNo: r.original_receipt_no,
    totalIn: r.total_in,
    totalOut: r.total_out,
    difference: r.difference,
    differenceSettlement: r.difference_settlement,
    note: r.note
  }))
}