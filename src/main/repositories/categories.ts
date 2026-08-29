import { getDb } from '../database'
import type { Category, CategoryInput } from '@shared/types'

interface CategoryRow {
  id: number
  name: string
  sort_order: number
}

function rowToCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, sortOrder: row.sort_order }
}

export function listCategories(): Category[] {
  const rows = getDb()
    .prepare('SELECT * FROM categories ORDER BY sort_order, name')
    .all() as CategoryRow[]
  return rows.map(rowToCategory)
}

export function createCategory(input: CategoryInput): Category {
  const db = getDb()
  const name = input.name.trim()
  if (!name) throw new Error('Kategori adı boş olamaz')
  const sortOrder = input.sortOrder ?? 0
  const result = db
    .prepare('INSERT INTO categories (name, sort_order, created_at) VALUES (?, ?, ?)')
    .run(name, sortOrder, Date.now())
  const row = db
    .prepare('SELECT * FROM categories WHERE id = ?')
    .get(result.lastInsertRowid) as CategoryRow
  return rowToCategory(row)
}

export function updateCategory(id: number, input: CategoryInput): Category {
  const db = getDb()
  const name = input.name.trim()
  if (!name) throw new Error('Kategori adı boş olamaz')
  const sortOrder = input.sortOrder ?? 0
  db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?').run(
    name,
    sortOrder,
    id
  )
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
    | CategoryRow
    | undefined
  if (!row) throw new Error('Kategori bulunamadı')
  return rowToCategory(row)
}

export function removeCategory(id: number): void {
  const db = getDb()
  const productCount = db
    .prepare('SELECT COUNT(*) AS c FROM products WHERE category_id = ?')
    .get(id) as { c: number }
  if (productCount.c > 0) {
    throw new Error(
      `Bu kategoride ${productCount.c} ürün var; önce ürünleri taşıyın veya silin`
    )
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
}