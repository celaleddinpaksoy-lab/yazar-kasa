import { getDb } from '../database'
import { adjustStock } from './stock'
import { recomputeBalances } from '../repositories/customers'
import type {
  PaymentMethod,
  SaleHistoryDetail,
  SalesHistoryItem
} from '@shared/types'

interface HistoryRow {
  id: number
  receipt_no: string
  created_at: number
  customer_id: number | null
  customer_name: string | null
  total: number
  paid_amount: number
  debt_amount: number
  status: string
  created_by_name: string | null
  returns_count: number
  exchanges_count: number
}

export function listSalesHistory(query?: {
  search?: string
  from?: number
  to?: number
}): SalesHistoryItem[] {
  const db = getDb()
  const where: string[] = []
  const params: Array<string | number> = []

  const search = query?.search?.trim()
  if (search) {
    where.push('(s.receipt_no LIKE ? OR c.name LIKE ?)')
    const like = `%${search}%`
    params.push(like, like)
  }
  if (query?.from != null) {
    where.push('s.created_at >= ?')
    params.push(query.from)
  }
  if (query?.to != null) {
    where.push('s.created_at <= ?')
    params.push(query.to)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT s.id, s.receipt_no, s.created_at, s.customer_id, c.name AS customer_name,
              s.total, s.paid_amount, s.debt_amount, s.status, u.name AS created_by_name,
              (SELECT COUNT(*) FROM returns r WHERE r.original_sale_id = s.id)  AS returns_count,
              (SELECT COUNT(*) FROM exchanges e WHERE e.original_sale_id = s.id) AS exchanges_count
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.created_by
       ${whereSql}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 500`
    )
    .all(...params) as HistoryRow[]

  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receipt_no,
    createdAt: r.created_at,
    customerId: r.customer_id,
    customerName: r.customer_name,
    total: r.total,
    paidAmount: r.paid_amount,
    debtAmount: r.debt_amount,
    status: r.status,
    createdByName: r.created_by_name,
    returnsCount: r.returns_count,
    exchangesCount: r.exchanges_count
  }))
}

interface ItemRow {
  product_id: number
  name: string | null
  barcode: string | null
  quantity: number
  unit_price: number
  discount: number
  line_total: number
}

export function getSaleHistoryDetail(id: number): SaleHistoryDetail {
  const db = getDb()
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, u.name AS created_by_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id = ?`
    )
    .get(id) as {
    receipt_no: string
    customer_id: number | null
    customer_name: string | null
    subtotal: number
    discount_total: number
    total: number
    paid_amount: number
    debt_amount: number
    is_credit: number
    status: string
    note: string | null
    created_by_name: string | null
    created_at: number
  } | undefined

  if (!sale) throw new Error('Satış bulunamadı')

  const items = db
    .prepare(
      `SELECT si.product_id, p.name, p.barcode, si.quantity, si.unit_price, si.discount, si.line_total
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ? ORDER BY si.id`
    )
    .all(id) as ItemRow[]

  const payments = db
    .prepare(
      `SELECT payment_method, amount FROM sale_payments
       WHERE sale_id = ? AND kind = 'sale' ORDER BY id`
    )
    .all(id) as Array<{ payment_method: PaymentMethod; amount: number }>

  return {
    id,
    receiptNo: sale.receipt_no,
    createdAt: sale.created_at,
    subtotal: sale.subtotal,
    discountTotal: sale.discount_total,
    total: sale.total,
    paidAmount: sale.paid_amount,
    debtAmount: sale.debt_amount,
    isCredit: sale.is_credit === 1,
    status: sale.status,
    note: sale.note,
    customerId: sale.customer_id,
    customerName: sale.customer_name,
    createdByName: sale.created_by_name,
    items: items.map((r) => ({
      productId: r.product_id,
      name: r.name ?? 'Silinmiş ürün',
      barcode: r.barcode,
      quantity: r.quantity,
      unitPrice: r.unit_price,
      discount: r.discount,
      lineTotal: r.line_total
    })),
    payments: payments.map((p) => ({ method: p.payment_method, amount: p.amount }))
  }
}

export function updateSaleDate(id: number, createdAt: number): SaleHistoryDetail {
  const db = getDb()
  if (!Number.isFinite(createdAt) || createdAt <= 0) throw new Error('Geçersiz tarih')

  const old = db
    .prepare('SELECT sale_id FROM sale_payments WHERE sale_id = ? LIMIT 1')
    .get(id)

  const exec = db.transaction(() => {
    db.prepare('UPDATE sales SET created_at = ? WHERE id = ?').run(createdAt, id)
    if (old) {
      db.prepare('UPDATE sale_payments SET created_at = ? WHERE sale_id = ?').run(createdAt, id)
      db.prepare('UPDATE debt_movements SET created_at = ? WHERE sale_id = ?').run(createdAt, id)
    }
  })
  exec()

  return getSaleHistoryDetail(id)
}

export function updateSaleCustomer(
  id: number,
  customerId: number | null
): SaleHistoryDetail {
  const db = getDb()
  if (customerId != null) {
    const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId)
    if (!c) throw new Error('Müşteri bulunamadı')
  }

  const prev = getSaleHistoryDetail(id)

  const exec = db.transaction(() => {
    // Satış sahibini güncelle
    db.prepare('UPDATE sales SET customer_id = ? WHERE id = ?').run(customerId, id)
    // Satışın kendi ödemelerini güncelle
    db.prepare('UPDATE sale_payments SET customer_id = ? WHERE sale_id = ? AND kind = ?')
      .run(customerId, id, 'sale')

    // Satışın kendi veresiye hareketini taşı
    const saleMovement = db
      .prepare(
        'SELECT id, amount, balance_after FROM debt_movements WHERE sale_id = ?'
      )
      .get(id) as { id: number; amount: number; balance_after: number } | undefined

    if (saleMovement) {
      db.prepare(
        'UPDATE debt_movements SET customer_id = ?, balance_after = 0 WHERE id = ?'
      ).run(customerId, saleMovement.id)
    }

    // Eski ve yeni müşteri bakiyelerini yeniden hesapla
    for (const cid of new Set([prev.customerId, customerId])) {
      if (cid != null) recomputeBalances(cid)
    }
  })
  exec()

  return getSaleHistoryDetail(id)
}

interface ReversibleItem {
  product_id: number
  quantity: number
}

/**
 * SATIŞ SİL — tam geri alım.
 * Tek atomik transaction. Stok iade (+satış kalemleri, −iade kalemleri,
 * değişimde in/− out/+), satışın + bağlı iade/değişimin ödeme & borç kayıtları
 * silinir (kasa toplamları otomatik düzelir), ilgili müşteri bakiyeleri yeniden hesaplanır.
 * Ayrıca iade/değişim kayıtları da silinir (kullanıcı kararı).
 */
export function deleteSale(id: number): { ok: boolean; message: string } {
  const db = getDb()

  // Satış ve bağlı iade/değişim kayıtlarını topla
  const sale = db
    .prepare('SELECT customer_id, receipt_no FROM sales WHERE id = ?')
    .get(id) as { customer_id: number | null; receipt_no: string } | undefined
  if (!sale) return { ok: false, message: 'Satış bulunamadı' }

  const returns = db
    .prepare(
      `SELECT r.id, r.customer_id, r.return_no,
              (SELECT COUNT(*) FROM return_payments rp WHERE rp.return_id = r.id) AS has_return_pay,
              (SELECT COUNT(*) FROM debt_movements dm WHERE dm.return_id = r.id) AS has_debt
       FROM returns r WHERE r.original_sale_id = ?`
    )
    .all(id) as Array<{ id: number; customer_id: number | null; return_no: string }>

  const exchanges = db
    .prepare('SELECT id, exchange_no, customer_id FROM exchanges WHERE original_sale_id = ?')
    .all(id) as Array<{ id: number; exchange_no: string; customer_id: number | null }>

  const affectedCustomers = new Set<number | null>([sale.customer_id])
  for (const r of returns) affectedCustomers.add(r.customer_id)
  for (const e of exchanges) affectedCustomers.add(e.customer_id)

  const exec = db.transaction(() => {
    // 1) Stok geri alımı
    const saleItems = db
      .prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?')
      .all(id) as ReversibleItem[]
    for (const it of saleItems) adjustStock(it.product_id, it.quantity)

    for (const r of returns) {
      const rItems = db
        .prepare(
          'SELECT product_id, quantity FROM return_items WHERE return_id = ?'
        )
        .all(r.id) as ReversibleItem[]
      for (const it of rItems) adjustStock(it.product_id, -it.quantity)
    }

    for (const e of exchanges) {
      const eItems = db
        .prepare(
          'SELECT product_id, quantity, direction FROM exchange_items WHERE exchange_id = ?'
        )
        .all(e.id) as Array<ReversibleItem & { direction: 'in' | 'out' }>
      for (const it of eItems) {
        // in → o stok geri çekilir; out → geri gelir
        adjustStock(it.product_id, it.direction === 'in' ? -it.quantity : it.quantity)
      }
    }

    // 2) Satış ödemelerini & borç hareketini sil (kasa/bakiye otomatik düzelsin)
    db.prepare('DELETE FROM sale_payments WHERE sale_id = ? AND kind = ?').run(id, 'sale')
    db.prepare('DELETE FROM debt_movements WHERE sale_id = ?').run(id)

    // 3) Bağlı iadeleri sil (items CASCADE; ödeme + borç sil)
    for (const r of returns) {
      db.prepare('DELETE FROM return_payments WHERE return_id = ?').run(r.id)
      db.prepare('DELETE FROM debt_movements WHERE return_id = ?').run(r.id)
      db.prepare('DELETE FROM returns WHERE id = ?').run(r.id)
    }

    // 4) Bağlı değişimlerin ödeme/borç kayıtlarını sil (referans yok → note ile eşle)
    for (const e of exchanges) {
      db.prepare(
        `DELETE FROM sale_payments WHERE sale_id IS NULL AND kind = 'exchange' AND note LIKE ?`
      ).run(`%(${e.exchange_no})%`)
      db.prepare(
        `DELETE FROM return_payments WHERE return_id IS NULL AND kind = 'refund' AND note LIKE ?`
      ).run(`%(${e.exchange_no})%`)
      db.prepare(
        `DELETE FROM debt_movements WHERE source = 'exchange' AND note LIKE ?`
      ).run(`%(${e.exchange_no})%`)
      db.prepare('DELETE FROM exchanges WHERE id = ?').run(e.id)
    }

    // 5) Satışı sil (items CASCADE)
    db.prepare('DELETE FROM sales WHERE id = ?').run(id)

    // 6) Eski bakiyeleri yeniden kur
    for (const cid of affectedCustomers) {
      if (cid != null) recomputeBalances(cid)
    }
  })
  exec()

  return { ok: true, message: `Satış (${sale.receipt_no}) ve bağlı iade/değişimler silindi` }
}
