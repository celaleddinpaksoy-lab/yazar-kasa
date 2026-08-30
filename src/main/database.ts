import Database from 'better-sqlite3'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { getDbPath, getRestorePendingPath, ensureDataDirectory } from './db'
import { SCHEMA_SQL } from './schema'
import { seedDefaultAdmin } from './repositories/users'

let db: Database.Database | null = null

/**
 * Geri yükleme talebi varsa uygular (açılışta, DB bağlantısı kurulmadan önce).
 * backups:restore IPC'si bayrak dosyasını yazar ve uygulamayı yeniden başlatır;
 * burada bayrak görülünce hedef dosya değiştirilir. Eski WAL/SHM kalıntıları
 * temizlenir ki eski veriyle karışmasın; şema aşağıda migrasyonla tazelenir.
 */
function applyPendingRestore(): void {
  const target = getDbPath()
  const flag = getRestorePendingPath()
  if (!existsSync(flag)) return
  try {
    const source = readFileSync(flag, 'utf8').trim()
    if (!source || !existsSync(source)) {
      unlinkSync(flag)
      return
    }
    // Atomik değiştirme: önce geçici dosyaya kopyala, sonra yerine taşı.
    // Kopya başarısız olursa mevcut veri ve WAL/SHM bozulmadan kalır.
    const tmp = `${target}.restoring`
    copyFileSync(source, tmp)
    for (const f of [`${target}-wal`, `${target}-shm`]) {
      if (existsSync(f)) rmSync(f, { force: true })
    }
    renameSync(tmp, target)
    writeFileSync(`${target}.restored`, new Date().toISOString())
    unlinkSync(flag)
  } catch (err) {
    console.error('[restore] Geri yükleme uygulanamadı, mevcut veri korundu:', err)
    if (existsSync(`${target}.restoring`)) rmSync(`${target}.restoring`, { force: true })
  }
}

/**
 * Sürüm bazlı migrasyonlar (PRAGMA user_version). Her öğe koşulludur:
 * yalnızca ilgili eski şema gerçekten mevcutsa dokunur. Migrasyonlar
 * SCHEMA_SQL'den SONRA, ardından şema bir kez daha uygulanır (düşürülen
 * tablolar yeniden kurulur).
 */
const MIGRATIONS: Array<(database: Database.Database) => void> = [
  // v1: cash_shifts zaman sütunları TEXT → INTEGER (ms). Boş eski tabloyu düşür.
  (database) => {
    const row = database
      .prepare(
        "SELECT COUNT(*) AS c FROM pragma_table_info('cash_shifts') WHERE name = 'opened_at' AND type = 'TEXT'"
      )
      .get() as { c: number }
    if (row.c > 0) database.exec('DROP TABLE IF EXISTS cash_shifts;')
  },
  // v2: müşteri taksit vade günü (1-31, boş = hatırlatma yok)
  (database) => {
    const row = database
      .prepare(
        "SELECT COUNT(*) AS c FROM pragma_table_info('customers') WHERE name = 'installment_day'"
      )
      .get() as { c: number }
    if (row.c === 0) database.exec('ALTER TABLE customers ADD COLUMN installment_day INTEGER;')
  },
  // v3: alış kaydı tipi — purchase (satın alma) | supplier_return (tedarikçi iadesi)
  (database) => {
    const row = database
      .prepare(
        "SELECT COUNT(*) AS c FROM pragma_table_info('purchases') WHERE name = 'kind'"
      )
      .get() as { c: number }
    if (row.c === 0) {
      database.exec(
        "ALTER TABLE purchases ADD COLUMN kind TEXT NOT NULL DEFAULT 'purchase';"
      )
    }
  },
  // v4: zaman (ms) aralık sorguları için indeksler (kasa akışı + raporlar)
  (database) => {
    const want = [
      'idx_sale_payments_created_at',
      'idx_returns_created_at',
      'idx_exchanges_created_at',
      'idx_purchases_created_at',
      'idx_debt_movements_created_at'
    ]
    const existing = new Set(
      (
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all() as Array<{ name: string }>
      ).map((r) => r.name)
    )
    const create: Record<string, string> = {
      idx_sale_payments_created_at: 'CREATE INDEX IF NOT EXISTS idx_sale_payments_created_at ON sale_payments(created_at)',
      idx_returns_created_at: 'CREATE INDEX IF NOT EXISTS idx_returns_created_at ON returns(created_at)',
      idx_exchanges_created_at: 'CREATE INDEX IF NOT EXISTS idx_exchanges_created_at ON exchanges(created_at)',
      idx_purchases_created_at: 'CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at)',
      idx_debt_movements_created_at: 'CREATE INDEX IF NOT EXISTS idx_debt_movements_created_at ON debt_movements(created_at)'
    }
    for (const name of want) {
      if (!existing.has(name)) {
        database.exec(create[name])
      }
    }
  },
  // v5: değişim kaynağını fişe bağlar — iade/değişim çift kullanımı engeli
  (database) => {
    const row = database
      .prepare(
        "SELECT COUNT(*) AS c FROM pragma_table_info('exchanges') WHERE name = 'original_sale_id'"
      )
      .get() as { c: number }
    if (row.c === 0) {
      database.exec('ALTER TABLE exchanges ADD COLUMN original_sale_id INTEGER REFERENCES sales(id);')
    }
    database.exec(
      'CREATE INDEX IF NOT EXISTS idx_exchanges_original_sale ON exchanges(original_sale_id);'
    )
  }
]

export function getDb(): Database.Database {
  if (!db) throw new Error('Veritabanı henüz başlatılmadı')
  return db
}

export function isDbReady(): boolean {
  return db !== null
}

/**
 * Veritabanını açar, şemayı kurar, migrasyonları uygular ve şemayı tekrar
 * kurar (migrasyonlar tablo düşürdüyse yeniden oluşturur).
 * uygulama ready olduktan sonra çağrılır.
 */
export function initDatabase(): void {
  if (db) return
  ensureDataDirectory()
  applyPendingRestore()
  db = new Database(getDbPath())
  const database = db
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')

  database.exec(SCHEMA_SQL)

  const current = database.pragma('user_version', { simple: true }) as number
  if (current < MIGRATIONS.length) {
    const apply = database.transaction(() => {
      for (let i = current; i < MIGRATIONS.length; i++) {
        MIGRATIONS[i](database)
        database.pragma(`user_version = ${i + 1}`)
      }
    })
    apply()
  }

  database.exec(SCHEMA_SQL)
  seedDefaultAdmin()
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}