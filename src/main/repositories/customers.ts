import { getDb } from '../database'
import type {
  Customer,
  CustomerInput,
  CustomerWithBalance,
  CustomerDetail,
  CustomerMovement,
  CustomerMovementInput,
  CustomerPayInput,
  PaymentMethod
} from '@shared/types'

export interface CustomerRow {
  id: number
  name: string
  phone: string | null
  note: string | null
  installment_day: number | null
  created_at: number
  updated_at: number
}

export interface MovementRow {
  id: number
  customer_id: number | null
  supplier_id: number | null
  date: string
  amount: number
  balance_after: number
  source: string
  note: string | null
  is_manual: number
  payment_method: PaymentMethod | null
  created_at: number
}

export function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    note: row.note,
    installmentDay: row.installment_day,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listCustomers(): Customer[] {
  const rows = getDb()
    .prepare('SELECT * FROM customers ORDER BY name')
    .all() as CustomerRow[]
  return rows.map(rowToCustomer)
}

export function getCustomer(id: number): Customer | null {
  const row = getDb().prepare('SELECT * FROM customers WHERE id = ?').get(id) as
    | CustomerRow
    | undefined
  return row ? rowToCustomer(row) : null
}

export function getCustomerBalance(id: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM debt_movements WHERE customer_id = ?')
    .get(id) as { total: number }
  return row.total
}

export function listCustomersWithBalance(): CustomerWithBalance[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*, COALESCE((SELECT SUM(amount) FROM debt_movements m WHERE m.customer_id = c.id), 0) AS balance
       FROM customers c
       ORDER BY balance DESC, c.name`
    )
    .all() as Array<CustomerRow & { balance: number }>
  return rows.map((r) => ({ ...rowToCustomer(r), balance: r.balance }))
}

function rowToMovement(row: MovementRow): CustomerMovement {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    balanceAfter: row.balance_after,
    source: row.source,
    note: row.note,
    isManual: row.is_manual === 1,
    paymentMethod: row.payment_method,
    createdAt: row.created_at
  }
}

export function recomputeBalances(customerId: number): void {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, amount FROM debt_movements WHERE customer_id = ? ORDER BY date, id'
    )
    .all(customerId) as Array<{ id: number; amount: number }>
  let balance = 0
  const update = db.prepare('UPDATE debt_movements SET balance_after = ? WHERE id = ?')
  for (const row of rows) {
    balance += row.amount
    update.run(balance, row.id)
  }
}

export function getCustomerDetail(id: number): CustomerDetail {
  const db = getDb()
  const customer = getCustomer(id)
  if (!customer) throw new Error('Müşteri bulunamadı')

  const sums = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS debt,
        COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS paid
       FROM debt_movements WHERE customer_id = ?`
    )
    .get(id) as { debt: number; paid: number }

  const movements = (
    db
      .prepare(
        'SELECT * FROM debt_movements WHERE customer_id = ? ORDER BY date, id DESC'
      )
      .all(id) as MovementRow[]
  ).map(rowToMovement)

  return {
    customer,
    balance: sums.debt - sums.paid,
    totalDebt: sums.debt,
    totalPaid: sums.paid,
    movements
  }
}

export function createCustomer(input: CustomerInput): Customer {
  const db = getDb()
  const name = input.name.trim()
  if (!name) throw new Error('Müşteri adı boş olamaz')
  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO customers (name, phone, note, installment_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      input.phone?.trim() || null,
      input.note?.trim() || null,
      normalizeInstallmentDay(input.installmentDay),
      now,
      now
    )
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid) as CustomerRow
  return rowToCustomer(row)
}

export function updateCustomer(id: number, input: CustomerInput): Customer {
  const db = getDb()
  const existing = getCustomer(id)
  if (!existing) throw new Error('Müşteri bulunamadı')
  const name = input.name.trim() || existing.name
  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, note = ?, installment_day = ?, updated_at = ? WHERE id = ?`
  ).run(
    name,
    input.phone?.trim() || null,
    input.note?.trim() || null,
    normalizeInstallmentDay(input.installmentDay),
    Date.now(),
    id
  )
  return getCustomer(id)!
}

function normalizeInstallmentDay(day: number | null | undefined): number | null {
  if (day == null) return null
  const d = Math.round(day)
  if (!Number.isFinite(d) || d < 1 || d > 31) return null
  return d
}

function parseDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)
}

/**
 * MANUEL BORÇ EKLE — sadece admin (çağıran tarafta denetlenir).
 * Borç artışı kaydı (+), müşteri zinciri baştan bakiye ile yeniden hesaplanır.
 */
export function addManualDebt(
  customerId: number,
  input: CustomerMovementInput,
  createdBy: number
): CustomerDetail {
  const db = getDb()
  const amount = Math.round(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Borç tutarı geçersiz')
  const date = parseDay(input.date)

  db.transaction(() => {
    db.prepare(
      `INSERT INTO debt_movements
         (customer_id, date, amount, balance_after, source, note, is_manual, created_by, created_at)
       VALUES (?, ?, ?, 0, 'manual', ?, 1, ?, ?)`
    ).run(
      customerId,
      date,
      amount,
      input.note?.trim() || null,
      createdBy,
      Date.now()
    )
    recomputeBalances(customerId)
  })()
  return getCustomerDetail(customerId)
}

/**
 * TAHsilat / ÖDEME AL — sadece admin. Borç azalışı (−) kaydı.
 * Ödeme nakit ise kasa akışına da yansır (sale_payments, kind='manual').
 */
export function payCustomerDebt(
  customerId: number,
  input: CustomerPayInput,
  createdBy: number
): CustomerDetail {
  const db = getDb()
  const amount = Math.round(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Ödeme tutarı geçersiz')
  const date = parseDay(input.date)

  db.transaction(() => {
    db.prepare(
      `INSERT INTO debt_movements
         (customer_id, date, amount, balance_after, source, payment_method, note, is_manual, created_by, created_at)
       VALUES (?, ?, ?, 0, 'manual', ?, ?, 1, ?, ?)`
    ).run(
      customerId,
      date,
      -amount,
      input.paymentMethod,
      input.note?.trim() || null,
      createdBy,
      Date.now()
    )
    if (input.paymentMethod === 'cash') {
      db.prepare(
        `INSERT INTO sale_payments (customer_id, date, amount, payment_method, kind, note, is_manual, created_by, created_at)
         VALUES (?, ?, ?, 'cash', 'manual', ?, 1, ?, ?)`
      ).run(customerId, date, amount, input.note?.trim() || null, createdBy, Date.now())
    }
    recomputeBalances(customerId)
  })()
  return getCustomerDetail(customerId)
}

export function editManualMovement(
  movementId: number,
  input: CustomerMovementInput
): CustomerDetail {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM debt_movements WHERE id = ?')
    .get(movementId) as MovementRow | undefined
  if (!row) throw new Error('Hareket bulunamadı')
  if (!row.is_manual) throw new Error('Otomatik satış kayıtları düzenlenemez')
  if (row.customer_id == null) throw new Error('Müşteri hareketi değil')
  const customerId = row.customer_id

  const amount = Math.round(input.amount)
  if (!Number.isFinite(amount) || amount === 0) throw new Error('Tutar geçersiz')
  const date = parseDay(input.date)

  db.transaction(() => {
    db.prepare(
      'UPDATE debt_movements SET amount = ?, date = ?, note = ? WHERE id = ?'
    ).run(amount, date, input.note?.trim() || null, movementId)
    recomputeBalances(customerId)
  })()
  return getCustomerDetail(customerId)
}

export function removeManualMovement(movementId: number): CustomerDetail {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM debt_movements WHERE id = ?')
    .get(movementId) as MovementRow | undefined
  if (!row) throw new Error('Hareket bulunamadı')
  if (!row.is_manual) throw new Error('Otomatik satış kayıtları silinemez')
  if (row.customer_id == null) throw new Error('Müşteri hareketi değil')
  const customerId = row.customer_id

  db.transaction(() => {
    db.prepare('DELETE FROM debt_movements WHERE id = ?').run(movementId)
    recomputeBalances(customerId)
  })()
  return getCustomerDetail(customerId)
}