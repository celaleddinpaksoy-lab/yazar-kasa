import { getDb } from '../database'
import { computeEan13 } from '@shared/barcode'
import { setStock } from '../services/stock'
import type { Product, ProductInput, ProductQuery } from '@shared/types'

interface ProductRow {
  id: number
  barcode: string
  name: string
  category_id: number | null
  category_name: string | null
  purchase_price: number
  sale_price: number
  stock_qty: number
  min_stock: number
  image: string | null
  note: string | null
  is_active: number
  created_at: number
  updated_at: number
}

function normalize(input: ProductInput): ProductInput {
  return {
    ...input,
    name: input.name.trim(),
    purchasePrice: Math.max(0, Math.round(input.purchasePrice ?? 0)),
    salePrice: Math.max(0, Math.round(input.salePrice ?? 0)),
    stockQty: Math.max(0, input.stockQty ?? 0),
    minStock: Math.max(0, input.minStock ?? 0)
  }
}

function barcodeFromId(id: number): string {
  return computeEan13(`8${String(id).padStart(11, '0')}`)
}

function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    purchasePrice: row.purchase_price,
    salePrice: row.sale_price,
    stockQty: row.stock_qty,
    minStock: row.min_stock,
    image: row.image,
    note: row.note,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const SELECT_BASE = `
  SELECT p.*, c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id`

export function listProducts(query: ProductQuery = {}): Product[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (query.search && query.search.trim()) {
    where.push('(p.name LIKE ? OR p.barcode LIKE ?)')
    const like = `%${query.search.trim()}%`
    params.push(like, like)
  }
  if (query.categoryId != null) {
    where.push('p.category_id = ?')
    params.push(query.categoryId)
  }
  if (query.activeOnly === true) {
    where.push('p.is_active = 1')
  }

  const sql =
    SELECT_BASE +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY p.name'
  const rows = db.prepare(sql).all(...params) as ProductRow[]
  return rows.map(rowToProduct)
}

export function getProduct(id: number): Product | null {
  const row = getDb().prepare(`${SELECT_BASE} WHERE p.id = ?`).get(id) as
    | ProductRow
    | undefined
  return row ? rowToProduct(row) : null
}

export function createProduct(input: ProductInput): Product {
  const db = getDb()
  const data = normalize(input)
  if (!data.name) throw new Error('Ürün adı boş olamaz')

  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO products
       (barcode, name, category_id, purchase_price, sale_price, stock_qty, min_stock, note, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const result = insert.run(
    '',
    data.name,
    data.categoryId ?? null,
    data.purchasePrice,
    data.salePrice,
    data.stockQty,
    data.minStock,
    data.note ?? null,
    data.isActive === false ? 0 : 1,
    now,
    now
  )
  const id = Number(result.lastInsertRowid)
  const barcode = data.barcode && data.barcode.trim() ? data.barcode.trim() : barcodeFromId(id)
  db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(barcode, id)
  setStock(id, data.stockQty ?? 0)
  return getProduct(id)!
}

export function updateProduct(id: number, input: ProductInput): Product {
  const db = getDb()
  const existing = db
    .prepare('SELECT * FROM products WHERE id = ?')
    .get(id) as ProductRow | undefined
  if (!existing) throw new Error('Ürün bulunamadı')

  const data = normalize({ ...(input as ProductInput) })
  if (data.name === '') data.name = existing.name

  let barcode = data.barcode
  if (barcode !== undefined) {
    barcode = barcode.trim()
    if (!barcode) barcode = existing.barcode || barcodeFromId(id)
  } else {
    barcode = existing.barcode || barcodeFromId(id)
  }

  db.prepare(
    `UPDATE products SET
       barcode = ?, name = ?, category_id = ?, purchase_price = ?, sale_price = ?,
       min_stock = ?, note = ?, is_active = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    barcode,
    data.name,
    data.categoryId ?? null,
    data.purchasePrice,
    data.salePrice,
    data.minStock,
    data.note ?? null,
    data.isActive === false ? 0 : 1,
    Date.now(),
    id
  )

  if (data.stockQty !== undefined && data.stockQty !== existing.stock_qty) {
    setStock(id, data.stockQty)
  }

  return getProduct(id)!
}

/**
 * Ürünü siler. Geçmişte satış/alış/iade/değişim kaydı varsa hard delete FK
 * bozabilir; böyle durumda ürün pasife alınır (is_active=0).
 */
export function removeProduct(id: number): void {
  const db = getDb()
  const refTables = ['sale_items', 'purchase_items', 'return_items', 'exchange_items']
  for (const table of refTables) {
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE product_id = ?`)
      .get(id) as { c: number }
    if (count.c > 0) {
      db.prepare('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?').run(
        Date.now(),
        id
      )
      return
    }
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(id)
}