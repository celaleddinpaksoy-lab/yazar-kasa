import { getDb } from '../database'
import type {
  BarPoint,
  DashboardSummary,
  DaySlice,
  DueReminder,
  LowStockItem,
  PeriodKey,
  PeriodProductRow,
  PeriodReport
} from '@shared/types'

interface SumRow {
  c: number
  t: number
}

interface ProfitRow {
  p: number
}

interface GroupRow {
  d: string
  c: number
  t: number
}

function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Yerel saat cinsinden gün başlangıcı (ms). */
function startOfDay(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return x.getTime()
}

function startOfWeek(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7 // Pazartesi = 0
  return x.getTime() - dow * 86400000
}

function startOfMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

function startOfYear(d: Date): number {
  return new Date(d.getFullYear(), 0, 1).getTime()
}

/** Seçilen dönemin [from, to) aralığını döner (to exclusive). */
export function periodRange(key: PeriodKey): { from: number; to: number } {
  const now = new Date()
  const to = startOfDay(now) + 86400000
  switch (key) {
    case 'today':
      return { from: startOfDay(now), to }
    case 'week':
      return { from: startOfWeek(now), to }
    case 'month':
      return { from: startOfMonth(now), to }
    case 'month6':
      return { from: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to }
    case 'year':
      return { from: startOfYear(now), to }
  }
}

function sumUnion(table: string, from: number, to: number): { c: number; t: number } {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t
       FROM ${table} WHERE created_at BETWEEN ? AND ?`
    )
    .get(from, to) as SumRow
  return { c: row.c, t: row.t }
}

/** Satış/iade/değişim kalem kârı: (satış fiyatı − maliyet) × adet, satışta genel indirim düşülür. */
function salesProfit(from: number, to: number): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(si.line_total - COALESCE(p.purchase_price, 0) * si.quantity), 0)
                - COALESCE((SELECT SUM(discount_total) FROM sales WHERE created_at BETWEEN ? AND ?), 0) AS p
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.created_at BETWEEN ? AND ?`
    )
    .get(from, to, from, to) as ProfitRow
  return row.p
}

function returnProfit(from: number, to: number): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(ri.line_total - COALESCE(p.purchase_price, 0) * ri.quantity), 0) AS p
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       LEFT JOIN products p ON p.id = ri.product_id
       WHERE r.created_at BETWEEN ? AND ?`
    )
    .get(from, to) as ProfitRow
  return row.p
}

function exchangeProfit(from: number, to: number): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(
         CASE WHEN ei.direction = 'out'
              THEN (ei.line_total - COALESCE(p.purchase_price, 0) * ei.quantity)
              ELSE -(ei.line_total - COALESCE(p.purchase_price, 0) * ei.quantity)
         END
       ), 0) AS p
       FROM exchange_items ei
       JOIN exchanges e ON e.id = ei.exchange_id
       LEFT JOIN products p ON p.id = ei.product_id
       WHERE e.created_at BETWEEN ? AND ?`
    )
    .get(from, to) as ProfitRow
  return row.p
}

function groupByDay(table: string, from: number, to: number): Map<string, { c: number; t: number }> {
  const rows = getDb()
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS d,
              COUNT(*) AS c, COALESCE(SUM(total), 0) AS t
       FROM ${table} WHERE created_at BETWEEN ? AND ?
       GROUP BY d ORDER BY d`
    )
    .all(from, to) as GroupRow[]
  return new Map(rows.map((r) => [r.d, { c: r.c, t: r.t }]))
}

/** Aynı dönemin günlük dilimleri (satış − iade + değişim farkı). */
function buildDays(from: number, to: number): DaySlice[] {
  const sales = groupByDay('sales', from, to)
  const returns = groupByDay('returns', from, to)
  const exchanges = getDb()
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS d,
              COUNT(*) AS c, COALESCE(SUM(total_out - total_in), 0) AS t
       FROM exchanges WHERE created_at BETWEEN ? AND ?
       GROUP BY d ORDER BY d`
    )
    .all(from, to) as GroupRow[]

  const keys = new Set<string>()
  for (const m of [sales, returns]) for (const k of m.keys()) keys.add(k)
  for (const r of exchanges) keys.add(r.d)

  const days: DaySlice[] = [...keys].sort().map((k) => {
    const s = sales.get(k)
    const r = returns.get(k)
    const e = exchanges.find((x) => x.d === k)
    const total = (s?.t ?? 0) - (r?.t ?? 0) + (e?.t ?? 0)
    const count = (s?.c ?? 0) + (e?.c ?? 0)
    return { label: k, total, count }
  })
  if (days.length > 1) {
    days.unshift({ label: 'toplam', total: days.reduce((a, b) => a + b.total, 0), count: days.reduce((a, b) => a + b.count, 0) })
  }
  return days
}

function productSales(from: number, to: number): PeriodProductRow[] {
  const db = getDb()
  const sold = db
    .prepare(
      `SELECT si.product_id,
              COALESCE(p.name, 'Silinmiş ürün') AS name,
              COALESCE(p.barcode, '') AS barcode,
              SUM(si.quantity) AS q, SUM(si.line_total) AS t
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.created_at BETWEEN ? AND ?
       GROUP BY si.product_id`
    )
    .all(from, to) as Array<{ product_id: number; name: string; barcode: string; q: number; t: number }>
  const returned = db
    .prepare(
      `SELECT ri.product_id, SUM(ri.quantity) AS q, SUM(ri.line_total) AS t
       FROM return_items ri JOIN returns r ON r.id = ri.return_id
       WHERE r.created_at BETWEEN ? AND ?
       GROUP BY ri.product_id`
    )
    .all(from, to) as Array<{ product_id: number; q: number; t: number }>
  const exchanged = db
    .prepare(
      `SELECT ei.product_id, ei.direction, SUM(ei.quantity) AS q
       FROM exchange_items ei JOIN exchanges e ON e.id = ei.exchange_id
       WHERE e.created_at BETWEEN ? AND ?
       GROUP BY ei.product_id, ei.direction`
    )
    .all(from, to) as Array<{ product_id: number; direction: string; q: number }>

  const rows: PeriodProductRow[] = sold.map((s) => ({
    productId: s.product_id,
    name: s.name,
    barcode: s.barcode,
    soldQty: s.q,
    soldTotal: s.t,
    returnedQty: 0,
    returnTotal: 0,
    exchangeOutQty: 0,
    exchangeInQty: 0
  }))
  const map = new Map(rows.map((r) => [r.productId, r]))
  for (const r of returned) {
    const row = map.get(r.product_id) ?? {
      productId: r.product_id,
      name: 'Silinmiş ürün',
      barcode: '',
      soldQty: 0,
      soldTotal: 0,
      returnTotal: 0,
      returnedQty: 0,
      exchangeOutQty: 0,
      exchangeInQty: 0
    }
    row.returnedQty = r.q
    row.returnTotal = r.t
    map.set(r.product_id, row)
  }
  for (const e of exchanged) {
    const row = map.get(e.product_id) ?? {
      productId: e.product_id,
      name: 'Silinmiş ürün',
      barcode: '',
      soldQty: 0,
      soldTotal: 0,
      returnTotal: 0,
      returnedQty: 0,
      exchangeOutQty: 0,
      exchangeInQty: 0
    }
    if (e.direction === 'out') row.exchangeOutQty = e.q
    else row.exchangeInQty = e.q
    map.set(e.product_id, row)
  }
  return [...map.values()].sort((a, b) => b.soldQty + b.exchangeOutQty - (a.soldQty + a.exchangeOutQty))
}

/** DÖNEM RAPORU — toplamlar + kâr + nakit akışı + alış + ürün tablosu + günlük dilimler. */
export function periodReport(from: number, to: number): PeriodReport {
  const db = getDb()
  const sales = sumUnion('sales', from, to)
  const returns = sumUnion('returns', from, to)
  const exchange = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total_in), 0) AS tin, COALESCE(SUM(total_out), 0) AS tout
       FROM exchanges WHERE created_at BETWEEN ? AND ?`
    )
    .get(from, to) as SumRow & { tin: number; tout: number }
  const creditRow = db
    .prepare(
      `SELECT COALESCE(SUM(debt_amount), 0) AS t FROM sales
       WHERE created_at BETWEEN ? AND ? AND is_credit = 1`
    )
    .get(from, to) as { t: number }
  const discountRow = db
    .prepare(`SELECT COALESCE(SUM(discount_total), 0) AS t FROM sales WHERE created_at BETWEEN ? AND ?`)
    .get(from, to) as { t: number }

  const moneyIn = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM sale_payments
       WHERE date BETWEEN ? AND ? AND kind IN ('sale', 'manual', 'exchange')`
    )
    .get(fmtDate(new Date(from)), fmtDate(new Date(to - 1))) as { t: number }
  const expense = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM sale_payments WHERE date BETWEEN ? AND ? AND kind = 'expense'`
    )
    .get(fmtDate(new Date(from)), fmtDate(new Date(to - 1))) as { t: number }
  const refund = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM return_payments WHERE date BETWEEN ? AND ? AND kind = 'refund'`
    )
    .get(fmtDate(new Date(from)), fmtDate(new Date(to - 1))) as { t: number }
  const collectedDebt = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM debt_movements
       WHERE date BETWEEN ? AND ? AND source = 'payment'`
    )
    .get(fmtDate(new Date(from)), fmtDate(new Date(to - 1))) as { t: number }

  const purchase = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t FROM purchases
       WHERE kind = 'purchase' AND created_at BETWEEN ? AND ?`
    )
    .get(from, to) as SumRow
  const supplierReturn = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS t FROM purchases
       WHERE kind = 'supplier_return' AND created_at BETWEEN ? AND ?`
    )
    .get(from, to) as { t: number }
  const paidSupplier = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM purchase_payments
       WHERE date BETWEEN ? AND ?`
    )
    .get(fmtDate(new Date(from)), fmtDate(new Date(to - 1))) as { t: number }

  const profit =
    salesProfit(from, to) - returnProfit(from, to) + exchangeProfit(from, to)
  const exchangeNet = exchange.tout - exchange.tin

  return {
    from,
    to,
    salesTotal: sales.t,
    salesCount: sales.c,
    discountTotal: discountRow.t,
    creditSales: creditRow.t,
    returnTotal: returns.t,
    returnCount: returns.c,
    exchangeIn: exchange.tin,
    exchangeOut: exchange.tout,
    exchangeNet,
    exchangeCount: exchange.c,
    netRevenue: sales.t - returns.t + exchangeNet,
    profit,
    moneyIn: moneyIn.t,
    cashExpense: expense.t + refund.t,
    collectedDebt: collectedDebt.t,
    purchaseTotal: purchase.t,
    purchaseCount: purchase.c,
    supplierReturnTotal: supplierReturn.t,
    paidSupplier: paidSupplier.t,
    productSales: productSales(from, to),
    days: buildDays(from, to)
  }
}

function lowStock(): LowStockItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, barcode, stock_qty, min_stock FROM products
       WHERE (min_stock > 0 AND stock_qty <= min_stock) OR stock_qty <= 0
       ORDER BY stock_qty ASC, name LIMIT 12`
    )
    .all() as Array<{ id: number; name: string; barcode: string; stock_qty: number; min_stock: number }>
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    barcode: r.barcode,
    stockQty: r.stock_qty,
    minStock: r.min_stock
  }))
}

function dueReminders(): DueReminder[] {
  const now = new Date()
  const todayStr = fmtDate(now)
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.phone, c.installment_day,
              COALESCE((SELECT SUM(amount) FROM debt_movements m WHERE m.customer_id = c.id), 0) AS balance
       FROM customers c
       WHERE c.installment_day IS NOT NULL
         AND (SELECT SUM(amount) FROM debt_movements m WHERE m.customer_id = c.id) > 0`
    )
    .all() as Array<{ id: number; name: string; phone: string | null; installment_day: number; balance: number }>
  return rows
    .map((r) => {
      const d = Math.min(Math.max(1, r.installment_day), dim)
      const due = new Date(now.getFullYear(), now.getMonth(), d)
      return {
        customerId: r.id,
        name: r.name,
        phone: r.phone,
        balance: r.balance,
        nextDueDate: fmtDate(due),
        overdue: fmtDate(due) < todayStr
      }
    })
    .sort((a, b) => (a.overdue === b.overdue ? (a.nextDueDate < b.nextDueDate ? -1 : 1) : a.overdue ? -1 : 1))
}

/** DASHBOARD — bugünün özeti + düşük stok + alacak/verecek + vade uyarıları + 7 günlük grafik. */
export function dashboardSummary(): DashboardSummary {
  const today = periodReport(periodRange('today').from, periodRange('today').to)
  const now = new Date()

  const received = getDb()
    .prepare(
      `SELECT COALESCE(SUM(b), 0) AS t FROM (
         SELECT (SELECT COALESCE(SUM(amount), 0) FROM debt_movements m WHERE m.customer_id = c.id) AS b
         FROM customers c
       ) WHERE b > 0`
    )
    .get() as { t: number }
  const payTotal = getDb()
    .prepare(
      `SELECT COALESCE(SUM(
         (SELECT COALESCE(SUM(total), 0) FROM purchases WHERE supplier_id = s.id)
         + (SELECT COALESCE(SUM(amount), 0) FROM debt_movements WHERE supplier_id = s.id)
         - (SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE supplier_id = s.id)
       ), 0) AS t FROM suppliers s`
    )
    .get() as { t: number }
  const pay = Math.max(0, payTotal.t)

  const last7: BarPoint[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const from = day.getTime()
    const to = from + 86400000
    const r = periodReport(from, to)
    last7.push({
      label: fmtDate(day),
      total: r.netRevenue,
      profit: r.profit,
      count: r.salesCount
    })
  }

  return {
    today: {
      total: today.netRevenue,
      count: today.salesCount,
      profit: today.profit,
      returnTotal: today.returnTotal,
      exchangeNet: today.exchangeNet,
      moneyIn: today.moneyIn,
      cashExpense: today.cashExpense
    },
    lowStock: lowStock(),
    customerReceivableTotal: received.t,
    supplierPayableTotal: pay,
    dueReminders: dueReminders(),
    last7
  }
}