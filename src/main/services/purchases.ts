import { getDb } from '../database'
import { adjustStock } from './stock'
import { nextPurchaseNo, getPurchase, getSupplier, recordCashExpense } from '../repositories/suppliers'
import type {
  CompletePurchaseInput,
  CompletePurchasePayload,
  PurchaseDetail,
  PurchaseLineInput,
  PurchaseSummary
} from '@shared/types'

function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function parseDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today()
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
  created_by: number | null
  created_at: number
  kind: string
}

interface PurchaseItemRow {
  id: number
  purchase_id: number
  product_id: number
  quantity: number
  unit_cost: number
  line_total: number
}

function validateLines(items: PurchaseLineInput[]): { id: number; qty: number; unit: number; line: number }[] {
  if (!items.length) throw new Error('En az bir ürün girin')
  return items.map((it) => {
    const qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty === 0) throw new Error('Alış miktarı geçersiz')
    const unit = Math.max(0, Math.round(it.unitCost))
    return { id: it.productId, qty, unit, line: Math.round(unit * qty) }
  })
}

/**
 * ALIŞ (tedarikçiden mal girişi) — atomik.
 * Stok + (tek stok kapısı), purchase_no A-…, kısmi ödeme → borç.
 * Nakit ödeme kasadan çıkar (sale_payments kind='expense').
 */
export function completePurchase(input: CompletePurchaseInput): PurchaseSummary {
  const db = getDb()
  const lines = validateLines(input.items).filter((l) => l.qty > 0)
  const total = lines.reduce((s, l) => s + l.line, 0)
  if (total <= 0) throw new Error('Alış tutarı sıfır olamaz')
  const paid = Math.max(0, Math.round(Number(input.paidAmount) || 0))
  if (paid > total) throw new Error('Ödenen tutar toplamı aşamaz')
  const paymentMethod = input.paymentMethod ?? null
  if (paid > 0 && !paymentMethod) throw new Error('Ödeme yöntemi seçin')
  if (paid < total && !input.supplierId) {
    throw new Error('Eksik ödemeli alış için tedarikçi gerekir')
  }

  if (input.supplierId != null) {
    const s = getSupplier(input.supplierId)
    if (!s) throw new Error('Tedarikçi bulunamadı')
  }

  const result = db.transaction(() => {
    const purchaseNo = nextPurchaseNo()
    const now = Date.now()
    const date = today()

    for (const l of lines) adjustStock(l.id, l.qty)

    const res = db
      .prepare(
        `INSERT INTO purchases (purchase_no, supplier_id, purchase_date, total, paid_amount, debt_amount, note, kind, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'purchase', ?, ?)`
      )
      .run(purchaseNo, input.supplierId ?? null, date, total, paid, total - paid, input.note?.trim() || null, input.createdBy, now)
    const purchaseId = Number(res.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?)`
    )
    for (const l of lines) insertItem.run(purchaseId, l.id, l.qty, l.unit, l.line)

    if (paid > 0) {
      db.prepare(
        `INSERT INTO purchase_payments (purchase_id, supplier_id, date, amount, payment_method, is_manual, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(purchaseId, input.supplierId ?? null, date, paid, paymentMethod, input.createdBy, now)
      if (paymentMethod === 'cash') {
        recordCashExpense(date, paid, `Alış (${purchaseNo})`, input.createdBy)
      }
    }

    return purchaseId
  })

  return getPurchase(result())
}

/**
 * TEDARİKÇİ İADESİ — alış kaydının tersi (satırlar negatif, stok −).
 * Tedarikçiye borç düşer; negatif stok engellenir.
 */
export function completeSupplierReturn(input: CompletePurchaseInput): PurchaseSummary {
  const db = getDb()
  const lines = validateLines(input.items)
    .filter((l) => l.qty !== 0)
    .map((l) => ({ ...l, qty: -Math.abs(l.qty) }))
  if (!lines.length) throw new Error('İade için ürün ekleyin')
  const total = lines.reduce((s, l) => s + l.line, 0)
  if (total >= 0) throw new Error('İade tutarı negatif olmalı')
  if (!input.supplierId) throw new Error('Tedarikçi iadesi için tedarikçi gerekir')
  if (Math.round(input.paidAmount) !== 0) throw new Error('Tedarikçi iadesinde ödeme alınamaz (borca/alacağa işlenir)')
  const s = getSupplier(input.supplierId)
  if (!s) throw new Error('Tedarikçi bulunamadı')

  const result = db.transaction(() => {
    const purchaseNo = nextPurchaseNo()
    const now = Date.now()
    const date = today()

    for (const l of lines) adjustStock(l.id, l.qty)

    const res = db
      .prepare(
        `INSERT INTO purchases (purchase_no, supplier_id, purchase_date, total, paid_amount, debt_amount, note, kind, created_by, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, 'supplier_return', ?, ?)`
      )
      .run(purchaseNo, input.supplierId, date, total, total, input.note?.trim() || null, input.createdBy, now)
    const purchaseId = Number(res.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?)`
    )
    for (const l of lines) insertItem.run(purchaseId, l.id, l.qty, l.unit, l.line)

    return purchaseId
  })

  return getPurchase(result())
}

export function getPurchaseDetail(id: number): PurchaseDetail {
  const db = getDb()
  const purchase = getPurchase(id)
  const items = db
    .prepare(
      `SELECT pi.product_id, p.name, p.barcode, pi.quantity, pi.unit_cost, pi.line_total
       FROM purchase_items pi
       LEFT JOIN products p ON p.id = pi.product_id
       WHERE pi.purchase_id = ?
       ORDER BY pi.id`
    )
    .all(id) as Array<{
    product_id: number
    name: string | null
    barcode: string
    quantity: number
    unit_cost: number
    line_total: number
  }>
  return {
    purchase,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name ?? '(ürün silinmiş)',
      barcode: i.barcode,
      quantity: i.quantity,
      unitCost: i.unit_cost,
      lineTotal: i.line_total
    }))
  }
}

/**
 * ALIŞ DÜZENLE — önce eski stok etkisini geri alır, sonra yenisini uygular.
 * Ödeme yöntemi/tarih güncellenmez (ödemeler tedarikçi defterinde ayrıdır);
 * tutar ve satırlar güncellenir. Eski stok geri alınamazsa (satılmış ürün)
 * işlem hata verir — stok tutarlılığı korunur.
 */
export function updatePurchase(id: number, input: CompletePurchasePayload): PurchaseSummary {
  const db = getDb()
  const existing = db
    .prepare('SELECT * FROM purchases WHERE id = ?')
    .get(id) as PurchaseRow | undefined
  if (!existing) throw new Error('Alış kaydı bulunamadı')
  if (existing.kind !== 'purchase') throw new Error('Tedarikçi iadesi düzenlenemez (silip yeniden ekleyin)')

  const lines = validateLines(input.items).filter((l) => l.qty > 0)
  const total = lines.reduce((s, l) => s + l.line, 0)
  if (total <= 0) throw new Error('Alış tutarı sıfır olamaz')
  if (total < existing.paid_amount) {
    throw new Error('Alış toplamı yapılan ödemeden küçük olamaz')
  }

  const result = db.transaction(() => {
    const oldItems = db
      .prepare('SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?')
      .all(id) as Array<{ product_id: number; quantity: number }>
    for (const oi of oldItems) adjustStock(oi.product_id, -oi.quantity) // eski etkiyi geri al

    for (const l of lines) adjustStock(l.id, l.qty) // yeni etki

    db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id)
    const insertItem = db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, line_total) VALUES (?, ?, ?, ?, ?)`
    )
    for (const l of lines) insertItem.run(id, l.id, l.qty, l.unit, l.line)

    const paid = existing.paid_amount
    db.prepare(
      `UPDATE purchases SET total = ?, paid_amount = ?, debt_amount = ?, note = ? WHERE id = ?`
    ).run(total, paid, total - paid, input.note?.trim() || null, id)

    return total
  })

  const newTotal = result()
  return getPurchase(id)
}

/**
 * ALIŞ SİL — stok etkisini tersine çevirir, kalemleri ve kaydı siler.
 * Tedarikçi defteri türetildiği için bakiye otomatik doğru kalır.
 */
export function removePurchase(id: number): void {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as
    | PurchaseRow
    | undefined
  if (!existing) throw new Error('Alış kaydı bulunamadı')

  db.transaction(() => {
    const items = db
      .prepare('SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?')
      .all(id) as Array<{ product_id: number; quantity: number }>
    for (const it of items) adjustStock(it.product_id, -it.quantity)
    db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id)
    db.prepare('DELETE FROM purchase_payments WHERE purchase_id = ?').run(id)
    db.prepare('DELETE FROM purchases WHERE id = ?').run(id)
  })()
}