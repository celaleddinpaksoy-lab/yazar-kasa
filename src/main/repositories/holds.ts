import { getDb } from '../database'
import type { Hold } from '@shared/types'

interface HoldRow {
  id: number
  hold_no: string
  customer_name: string | null
  items_json: string
  total: number
  status: string
  created_at: number
}

function rowToHold(row: HoldRow): Hold {
  return {
    id: row.id,
    holdNo: row.hold_no,
    customerName: row.customer_name,
    itemsJson: row.items_json,
    total: row.total,
    status: row.status,
    createdAt: row.created_at
  }
}

export function listActiveHolds(): Hold[] {
  const rows = getDb()
    .prepare("SELECT * FROM holds WHERE status = 'active' ORDER BY created_at DESC")
    .all() as HoldRow[]
  return rows.map(rowToHold)
}

export function createHold(input: {
  customerName?: string | null
  itemsJson: string
  total: number
  createdBy: number
}): Hold {
  const db = getDb()
  const key = 'hold_counter'
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  const next = (row ? parseInt(row.value, 10) : 0) + 1
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(next))
  const holdNo = `H-${Date.now()}-${next}`
  const res = db
    .prepare(
      `INSERT INTO holds (hold_no, customer_name, items_json, total, status, created_by, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      holdNo,
      input.customerName?.trim() || null,
      input.itemsJson,
      Math.max(0, Math.round(input.total)),
      input.createdBy,
      Date.now()
    )
  return rowToHold(
    db.prepare('SELECT * FROM holds WHERE id = ?').get(res.lastInsertRowid) as HoldRow
  )
}

export function removeHold(id: number): void {
  getDb().prepare('DELETE FROM holds WHERE id = ?').run(id)
}

export function completeHold(id: number): void {
  getDb().prepare("UPDATE holds SET status = 'completed' WHERE id = ?").run(id)
}