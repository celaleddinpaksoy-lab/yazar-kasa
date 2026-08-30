import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let dir = ''

/**
 * Her test dosyası kendi worker'ında koşar (vitest fileParallelism);
 * bu yüzden her dosya için ayrı geçici veri dizini + ayrı DB singleton'ı
 * oluşur. `YAZAR_KASA_DATA_DIR` önce ayarlanır, sonra initDatabase çağrılır —
 * böylece Electron `userData`'sına dokunulmaz.
 */
export async function setupDb(): Promise<void> {
  if (dir) return
  dir = mkdtempSync(join(tmpdir(), 'yazarkasa-test-'))
  process.env.YAZAR_KASA_DATA_DIR = dir
  const { initDatabase } = await import('../src/main/database')
  initDatabase()
}

export async function downDb(): Promise<void> {
  const { closeDatabase } = await import('../src/main/database')
  closeDatabase()
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = ''
  }
}

export function testDataDir(): string {
  return dir
}

export async function createTestProduct(
  name: string,
  opts: { stockQty?: number; purchasePrice?: number; salePrice?: number } = {}
): Promise<{ id: number; name: string }> {
  const { createProduct } = await import('../src/main/repositories/products')
  const p = createProduct({
    name,
    purchasePrice: 5000,
    salePrice: 10000,
    stockQty: 10,
    ...opts
  })
  return { id: p.id, name: p.name }
}

export function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}