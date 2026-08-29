import { getDb } from '../database'
import type {
  PaymentMethod,
  PurchaseKind,
  PurchaseSummary,
  Supplier,
  SupplierDetail,
  SupplierInput,
  SupplierMovement,
  SupplierMovementInput,
  SupplierPayInput,
  SupplierWithBalance
} from '@shared/types'

interface SupplierRow {
  id: number
  name: string
  phone: string | null
  address: string | null
  note: string | null
  created_at: number
  updated_at: number
}

interface PurchaseRow {
  id: number
  purchase_no: string
  supplier_id: number | null
  purchase_date: string
  total: number
  paid_amount: number
  debt_amount: number
  note: string | null
  created_at: number
  kind: PurchaseKind
}

export function rowToSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * TEDARİKÇİ BAKIYESI — türetilmiş (saklanmaz, yapı değişince kendiliğinden doğru).
 * Bakiye = Σ alışlar(total) + Σ manuel borç kayıtları(debt_movements, +)
 *         − Σ ödemeler(purchase_payments) − Σ tedarikçi iadeleri(total<0)
 * Pozitif = biz tedarikçiye borçluyuz; negatif = tedarikçi bize borçlu.
 */
export function getSupplierBalance(id: number): number {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = ?), 0)
         + COALESCE((SELECT SUM(amount) FROM debt_movements WHERE supplier_id = ?), 0)
         - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE supplier_id = ?), 0) AS b`
    )
    .get(id, id, id) as { b: number }
  return row.b
}

export function getSupplier(id: number): Supplier | null {
  const row = getDb().prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as
    | SupplierRow
    | undefined
  return row ? rowToSupplier(row) : null
}

export function listSuppliers(): Supplier[] {
  const rows = getDb().prepare('SELECT * FROM suppliers ORDER BY name').all() as SupplierRow[]
  return rows.map(rowToSupplier)
}

export function listSuppliersWithBalance(): SupplierWithBalance[] {
  const rows = listSuppliers()
  return rows.map((s) => ({ ...s, balance: getSupplierBalance(s.id) })).sort((a, b) => b.balance - a.balance)
}

export function createSupplier(input: SupplierInput): Supplier {
  const db = getDb()
  const name = input.name.trim()
  if (!name) throw new Error('Tedarikçi adı boş olamaz')
  const now = Date.now()
  const res = db
    .prepare(
      `INSERT INTO suppliers (name, phone, address, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      input.phone?.trim() || null,
      input.address?.trim() || null,
      input.note?.trim() || null,
      now,
      now
    )
  return getSupplier(Number(res.lastInsertRowid))!
}

export function updateSupplier(id: number, input: SupplierInput): Supplier {
  const db = getDb()
  const existing = getSupplier(id)
  if (!existing) throw new Error('Tedarikçi bulunamadı')
  db.prepare(
    `UPDATE suppliers SET name = ?, phone = ?, address = ?, note = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.name.trim() || existing.name,
    input.phone?.trim() || null,
    input.address?.trim() || null,
    input.note?.trim() || null,
    Date.now(),
    id
  )
  return getSupplier(id)!
}

export function removeSupplier(id: number): void {
  const db = getDb()
  const count = db
    .prepare('SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ?')
    .get(id) as { c: number }
  if (count.c > 0) throw new Error('Alış kaydı bulunan tedarikçi silinemez')
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
}

const PURCHASE_SELECT = `
  SELECT p.*, s.name AS supplier_name
  FROM purchases p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`

function rowToPurchase(row: PurchaseRow & { supplier_name?: string | null }): PurchaseSummary {
  return {
    id: row.id,
    purchaseNo: row.purchase_no,
    kind: row.kind ?? 'purchase',
    supplierName: row.supplier_name ?? null,
    purchaseDate: row.purchase_date,
    total: row.total,
    paidAmount: row.paid_amount,
    debtAmount: row.debt_amount,
    note: row.note,
    createdAt: row.created_at
  }
}

export function listPurchases(kind?: PurchaseKind): PurchaseSummary[] {
  const db = getDb()
  const rows = (
    kind
      ? db
          .prepare(`${PURCHASE_SELECT} WHERE p.kind = ? ORDER BY p.purchase_date DESC, p.id DESC LIMIT 200`)
          .all(kind)
      : db
          .prepare(`${PURCHASE_SELECT} ORDER BY p.purchase_date DESC, p.id DESC LIMIT 200`)
          .all()
  ) as Array<PurchaseRow & { supplier_name?: string | null }>
  return rows.map(rowToPurchase)
}

export function getPurchase(id: number): PurchaseSummary {
  const row = getDb().prepare(`${PURCHASE_SELECT} WHERE p.id = ?`).get(id) as
    | (PurchaseRow & { supplier_name?: string | null })
    | undefined
  if (!row) throw new Error('Alış kaydı bulunamadı')
  return rowToPurchase(row)
}

export function nextPurchaseNo(): string {
  const db = getDb()
  const key = 'purchase_counter'
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  const next = (row ? parseInt(row.value, 10) : 0) + 1
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(next))
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const ymd = `${d.getFullYear()}${m}${day}`
  return `A-${ymd}-${String(next).padStart(4, '0')}`
}

function parseDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)
}

export interface SupplierDetailRow {
  movement_id: number
  movement_date: string
  amount: number
  source: string
  note: string | null
  is_manual: number
  created_by: number | null
  created_at: number
}

export function getSupplierDetail(id: number): SupplierDetail {
  const db = getDb()
  const supplier = getSupplier(id)
  if (!supplier) throw new Error('Tedarikçi bulunamadı')

  const balance = getSupplierBalance(id)
  const sums = db
    .prepare(
      `SELECT
        COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = ? AND total > 0), 0)
        + COALESCE((SELECT SUM(amount) FROM debt_movements WHERE supplier_id = ? AND amount > 0), 0) AS owed,
        COALESCE((SELECT ABS(SUM(total)) FROM purchases WHERE supplier_id = ? AND total < 0), 0)
        + COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE supplier_id = ?), 0) AS paid`
    )
    .get(id, id, id, id) as { owed: number; paid: number }

  const movements = composeSupplierMovements(id)
  const purchases = (
    getDb()
      .prepare(
        `${PURCHASE_SELECT} WHERE p.supplier_id = ? ORDER BY p.purchase_date DESC, p.id DESC`
      )
      .all(id) as Array<PurchaseRow & { supplier_name?: string | null }>
  ).map(rowToPurchase)

  return {
    supplier,
    balance,
    totalDebt: sums.owed,
    totalPaid: sums.paid,
    movements,
    purchases
  }
}

function composeSupplierMovements(supplierId: number): SupplierMovement[] {
  const db = getDb()
  const purchases = db
    .prepare(
      `SELECT id, purchase_date AS d, total AS amt, kind,
              CASE WHEN kind = 'supplier_return' THEN 'Tedarikçi iadesi' ELSE 'Alış' END AS src,
              note AS n, created_by AS by, created_at AS at
       FROM purchases WHERE supplier_id = ?`
    )
    .all(supplierId) as Array<{
    d: string
    amt: number
    kind: string
    src: string
    n: string | null
    by: number | null
    at: number
  }>
  const payments = db
    .prepare(
      `SELECT date AS d, -amount AS amt, 'Ödeme' AS src, note AS n, created_by AS by, created_at AS at
       FROM purchase_payments WHERE supplier_id = ?`
    )
    .all(supplierId) as Array<{
    d: string
    amt: number
    src: string
    n: string | null
    by: number | null
    at: number
  }>
  const debt = db
    .prepare(
      `SELECT date AS d, amount AS amt,
              CASE WHEN amount > 0 THEN 'Manuel borç' ELSE 'Borç düşümü' END AS src,
              note AS n, created_by AS by, created_at AS at
       FROM debt_movements WHERE supplier_id = ?`
    )
    .all(supplierId) as Array<{
    d: string
    amt: number
    src: string
    n: string | null
    by: number | null
    at: number
  }>

  const all = [
    ...purchases.map((m) => ({ d: m.d, amt: m.amt, src: m.src, n: m.n, by: m.by, at: m.at, isManual: 0, id: 0 })),
    ...payments.map((m) => ({ d: m.d, amt: m.amt, src: m.src, n: m.n, by: m.by, at: m.at, isManual: m.n?.includes('manuel') ? 1 : 0, id: 0 })),
    ...debt.map((m) => ({ d: m.d, amt: m.amt, src: m.src, n: m.n, by: m.by, at: m.at, isManual: 1, id: 0 }))
  ].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.at - b.at))

  let running = 0
  return all.map((m) => {
    running += m.amt
    return {
      id: m.id,
      date: m.d,
      amount: m.amt,
      balanceAfter: running,
      source: m.src,
      note: m.n,
      isManual: m.isManual === 1,
      createdBy: m.by,
      createdAt: m.at
    }
  })
}

/**
 * MANUEL BORÇ EKLE (tedarikçiye) — admin. Bizim borcumuz artar (+).
 */
export function addManualSupplierDebt(
  supplierId: number,
  input: SupplierMovementInput,
  createdBy: number
): SupplierDetail {
  const db = getDb()
  const amount = Math.round(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Borç tutarı geçersiz')
  db.prepare(
    `INSERT INTO debt_movements (supplier_id, date, amount, balance_after, source, note, is_manual, created_by, created_at)
     VALUES (?, ?, ?, 0, 'manual', ?, 1, ?, ?)`
  ).run(
    supplierId,
    parseDay(input.date),
    amount,
    input.note?.trim() || null,
    createdBy,
    Date.now()
  )
  return getSupplierDetail(supplierId)
}

/**
 * TEDARİKÇİYE ÖDEME — admin. Borç azalır (−), nakitse kasadan çıkış kaydedilir.
 */
export function paySupplier(
  supplierId: number,
  input: SupplierPayInput,
  createdBy: number
): SupplierDetail {
  const db = getDb()
  const amount = Math.round(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Ödeme tutarı geçersiz')
  const date = parseDay(input.date)

  db.transaction(() => {
    db.prepare(
      `INSERT INTO purchase_payments (supplier_id, date, amount, payment_method, note, is_manual, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      supplierId,
      date,
      amount,
      input.paymentMethod as PaymentMethod,
      input.note?.trim() || null,
      createdBy,
      Date.now()
    )
    if (input.paymentMethod === 'cash') {
      recordCashExpense(date, amount, `Tedarikçi ödemesi (${supplierId})`, createdBy)
    }
  })()
  return getSupplierDetail(supplierId)
}

export function recordCashExpense(date: string, amount: number, note: string, createdBy: number): void {
  getDb()
    .prepare(
      `INSERT INTO sale_payments (customer_id, date, amount, payment_method, kind, note, is_manual, created_by, created_at)
       VALUES (NULL, ?, ?, 'cash', 'expense', ?, 1, ?, ?)`
    )
    .run(date, amount, note, createdBy, Date.now())
}

export function editManualSupplierMovement(
  movementId: number,
  input: SupplierMovementInput
): SupplierDetail {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM debt_movements WHERE id = ?')
    .get(movementId) as { id: number; supplier_id: number | null; is_manual: number } | undefined
  if (!row) throw new Error('Hareket bulunamadı')
  if (!row.supplier_id) throw new Error('Tedarikçi hareketi değil')
  if (!row.is_manual) throw new Error('Otomatik kayıtlar düzenlenemez')
  const amount = Math.round(input.amount)
  if (!Number.isFinite(amount) || amount === 0) throw new Error('Tutar geçersiz')
  db.prepare('UPDATE debt_movements SET amount = ?, date = ?, note = ? WHERE id = ?').run(
    amount,
    parseDay(input.date),
    input.note?.trim() || null,
    movementId
  )
  return getSupplierDetail(row.supplier_id)
}

export function removeManualSupplierMovement(movementId: number): SupplierDetail {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM debt_movements WHERE id = ?')
    .get(movementId) as { id: number; supplier_id: number | null; is_manual: number } | undefined
  if (!row) throw new Error('Hareket bulunamadı')
  if (!row.supplier_id) throw new Error('Tedarikçi hareketi değil')
  if (!row.is_manual) throw new Error('Otomatik kayıtlar silinemez')
  db.transaction(() => {
    db.prepare('DELETE FROM debt_movements WHERE id = ?').run(movementId)
  })()
  return getSupplierDetail(row.supplier_id)
}