import { getDb } from '../database'
import type { CashShiftSummary } from '@shared/types'

interface ShiftRow {
  id: number
  opened_at: number
  opening_balance: number
  opened_by: number
  closed_at: number | null
  closing_balance: number | null
  expected_balance: number | null
  note: string | null
  status: string
}

interface UserNameRow {
  name: string
}

function shiftTotals(openedAt: number, closedAt: number | null): {
  cashIn: number
  totalSales: number
  salesCount: number
} {
  const db = getDb()
  const end = closedAt ?? Date.now()
  const pay = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t
       FROM sale_payments
       WHERE kind IN ('sale', 'manual', 'exchange') AND payment_method = 'cash' AND created_at BETWEEN ? AND ?`
    )
    .get(openedAt, end) as { t: number }
  const expense = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t
       FROM sale_payments
       WHERE kind = 'expense' AND payment_method = 'cash' AND created_at BETWEEN ? AND ?`
    )
    .get(openedAt, end) as { t: number }
  const refund = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS t
       FROM return_payments
       WHERE kind = 'refund' AND payment_method = 'cash' AND created_at BETWEEN ? AND ?`
    )
    .get(openedAt, end) as { t: number }
  const sales = db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(total) FROM sales WHERE created_at BETWEEN ? AND ?), 0)
         - COALESCE((SELECT SUM(total) FROM returns WHERE created_at BETWEEN ? AND ?), 0)
         + (SELECT COALESCE(SUM(total_out) - SUM(total_in), 0) FROM exchanges WHERE created_at BETWEEN ? AND ?) AS t,
         (SELECT COUNT(*) FROM sales WHERE created_at BETWEEN ? AND ?) AS c`
    )
    .get(openedAt, end, openedAt, end, openedAt, end, openedAt, end) as { t: number; c: number }
  return { cashIn: pay.t - expense.t - refund.t, totalSales: sales.t, salesCount: sales.c }
}

function rowToSummary(row: ShiftRow): CashShiftSummary {
  const totals = shiftTotals(row.opened_at, row.closed_at)
  const openedByName = (
    getDb().prepare('SELECT name FROM users WHERE id = ?').get(row.opened_by) as UserNameRow | undefined
  )?.name ?? '—'
  return {
    id: row.id,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openingBalance: row.opening_balance,
    closingBalance: row.closing_balance,
    expectedBalance: row.expected_balance,
    cashIn: totals.cashIn,
    totalSales: totals.totalSales,
    salesCount: totals.salesCount,
    difference:
      row.status === 'closed' && row.closing_balance != null && row.expected_balance != null
        ? row.closing_balance - row.expected_balance
        : null,
    status: (row.status === 'open' ? 'open' : 'closed') as 'open' | 'closed',
    openedByName,
    note: row.note
  }
}

export function getOpenShift(): CashShiftSummary | null {
  const row = getDb()
    .prepare("SELECT * FROM cash_shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1")
    .get() as ShiftRow | undefined
  return row ? rowToSummary(row) : null
}

export function openShift(input: {
  openingBalance: number
  note?: string
  createdBy: number
}): CashShiftSummary {
  const db = getDb()
  if (getOpenShift()) throw new Error('Zaten açık bir kasa var. Önce kapanış yapmalısınız.')
  const openingBalance = Math.max(0, Math.round(input.openingBalance))
  const res = db
    .prepare(
      `INSERT INTO cash_shifts (opened_at, opening_balance, opened_by, note, status)
       VALUES (?, ?, ?, ?, 'open')`
    )
    .run(Date.now(), openingBalance, input.createdBy, input.note?.trim() || null)
  return rowToSummary(
    db.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(res.lastInsertRowid) as ShiftRow
  )
}

export function closeShift(input: {
  shiftId: number
  closingBalance: number
  note?: string
}): CashShiftSummary {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM cash_shifts WHERE id = ?')
    .get(input.shiftId) as ShiftRow | undefined
  if (!row) throw new Error('Kasa bulunamadı')
  if (row.status !== 'open') throw new Error('Bu kasa zaten kapanmış.')

  const closingBalance = Math.max(0, Math.round(input.closingBalance))
  const now = Date.now()
  const cashIn = shiftTotals(row.opened_at, now).cashIn
  const expectedBalance = row.opening_balance + cashIn

  db.prepare(
    `UPDATE cash_shifts
     SET closed_at = ?, closing_balance = ?, expected_balance = ?,
         note = COALESCE(?, note), status = 'closed'
     WHERE id = ?`
  ).run(now, closingBalance, expectedBalance, input.note?.trim() || null, input.shiftId)
  return rowToSummary(db.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(input.shiftId) as ShiftRow)
}

export function listShifts(): CashShiftSummary[] {
  const rows = getDb().prepare('SELECT * FROM cash_shifts ORDER BY opened_at DESC').all() as ShiftRow[]
  return rows.map(rowToSummary)
}