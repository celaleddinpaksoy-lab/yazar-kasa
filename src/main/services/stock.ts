import { getDb } from '../database'

/**
 * TEK STOK KAPISI.
 * Stok değiştirmesi gereken tüm işlemler (satış, iade, değişim, alış, tedarikçi iadesi,
 * ürün yönetimi) bu servisten geçmelidir. Başka yerden doğrudan UPDATE DELETE etmeyin.
 */
export function setStock(productId: number, qty: number): void {
  if (qty < 0) throw new Error('Stok negatif olamaz')
  getDb()
    .prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?')
    .run(qty, Date.now(), productId)
}

export function adjustStock(productId: number, delta: number): number {
  const db = getDb()
  const row = db
    .prepare('SELECT stock_qty FROM products WHERE id = ?')
    .get(productId) as { stock_qty: number } | undefined
  if (!row) throw new Error('Ürün bulunamadı')
  const next = row.stock_qty + delta
  if (next < 0) throw new Error('Yetersiz stok (negatif stok engellendi)')
  setStock(productId, next)
  return next
}

export function getStock(productId: number): number {
  const row = getDb()
    .prepare('SELECT stock_qty FROM products WHERE id = ?')
    .get(productId) as { stock_qty: number } | undefined
  if (!row) throw new Error('Ürün bulunamadı')
  return row.stock_qty
}