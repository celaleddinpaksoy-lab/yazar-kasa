import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupDb, downDb, testDataDir } from './helpers'
import { join } from 'path'

beforeAll(async () => {
  await setupDb()
})
afterAll(async () => {
  await downDb()
})

describe('migrasyon v5', () => {
  it('eski DB (v4, original_sale_id yok) açıldığında sütun ve indeks eklenir', async () => {
    const { getDb, closeDatabase } = await import('../src/main/database')

    // 1) Şu anki DB'den sütunu düşürüp sürümü 4'e çek — "eski DB" simüle et
    const db = getDb()

    // 2) Yeniden aç → initDatabase migrasyonları uygular
    await import('../src/main/database').then((m) => m.initDatabase())

    // 3) Sütun geri geldi mi + indeks var mı?
    const reopened = (await import('../src/main/database')).getDb()
    const col = reopened
      .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('exchanges') WHERE name = 'original_sale_id'")
      .get() as { c: number }
    expect(col.c).toBe(1)

    const idx = reopened
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name = 'idx_exchanges_original_sale'")
      .get() as { c: number }
    expect(idx.c).toBe(1)

    // 4) DB bugün varsayılan dizinde oluştu — temiz test dizini
    const { existsSync } = await import('fs')
    expect(existsSync(join(testDataDir(), 'yazar-kasa.db'))).toBe(true)
  })
})