import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDb } from '../database'
import { getBackupsDir, getDbPath, getRestorePendingPath } from '../db'
import type { BackupInfo } from '@shared/types'

export const BACKUP_KEEP_AUTO = 30

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function todayKey(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface BackupRow {
  id: number
  filename: string
  kind: 'auto' | 'manual' | 'import' | 'safety'
  note: string | null
  size: number
  created_by: number | null
  created_at: number
  created_name: string | null
}

/**
 * YEDEK AL — dosyayı backups klasörüne kopyalar ve kayıt düşer.
 * WAL modundayız; verinin eksiksiz olması için önce checkpoint (TRUNCATE).
 */
export function takeBackup(kind: BackupInfo['kind'], createdBy: number | null, note: string | null): BackupInfo {
  const dir = getBackupsDir()
  mkdirSync(dir, { recursive: true })
  const db = getDb()
  db.pragma('wal_checkpoint(TRUNCATE)')

  const filename = `yazar-kasa-${stamp()}.db`
  const dest = join(dir, filename)
  copyFileSync(getDbPath(), dest)
  const size = statSync(dest).size

  const res = db
    .prepare(
      `INSERT INTO backups (filename, kind, note, size, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(filename, kind, note, size, createdBy, Date.now())
  pruneAutoBackups()
  return getBackup(Number(res.lastInsertRowid))!
}

function getBackup(id: number): BackupInfo | null {
  const row = getDb()
    .prepare(
      `SELECT b.*, u.name AS created_name FROM backups b
       LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?`
    )
    .get(id) as BackupRow | undefined
  return row ? rowToBackup(row) : null
}

function rowToBackup(row: BackupRow): BackupInfo {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    note: row.note,
    size: row.size,
    createdByName: row.created_name,
    createdAt: row.created_at
  }
}

export function listBackups(): BackupInfo[] {
  const rows = getDb()
    .prepare(
      `SELECT b.*, u.name AS created_name FROM backups b
       LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC LIMIT 200`
    )
    .all() as BackupRow[]
  return rows.map(rowToBackup)
}

/** Eski otomatik yedekleri temizle (BACKUP_KEEP_AUTO'yu aşıyorsa). */
function pruneAutoBackups(): void {
  const db = getDb()
  const rows = db
    .prepare(`SELECT id, filename FROM backups WHERE kind = 'auto' ORDER BY created_at DESC`)
    .all() as Array<{ id: number; filename: string }>
  if (rows.length <= BACKUP_KEEP_AUTO) return
  const dir = getBackupsDir()
  for (const r of rows.slice(BACKUP_KEEP_AUTO)) {
    const p = join(dir, r.filename)
    if (existsSync(p)) unlinkSync(p)
    db.prepare('DELETE FROM backups WHERE id = ?').run(r.id)
  }
}

/** Günlük otomatik yedek — uygulama her açılışta bugün daha alınmadıysa alır. */
export function scheduleDailyAutoBackup(): void {
  try {
    const today = getDb().prepare(`SELECT 1 AS x FROM backups WHERE kind = 'auto' AND date(created_at / 1000, 'unixepoch', 'localtime') = ? LIMIT 1`).get(todayKey())
    if (today) return
    takeBackup('auto', null, 'Günlük otomatik')
  } catch {
    /* açılışta yedek alınamazsa sessiz geç; kullanıcı manuel alabilir */
  }
}

/** Harici dosyadan içeri aktar (yedekler klasörü + kayıt). Admin. */
export function importBackup(wantedName: string, data: Uint8Array, createdBy: number | null): BackupInfo {
  const dir = getBackupsDir()
  mkdirSync(dir, { recursive: true })
  const safe = String(wantedName || '').replace(/[^\w.-]/g, '_').slice(0, 80) || `yazar-kasa-import-${stamp().replace('_', '-')}.db`
  const filename = `imp-${stamp().replace('_', '-')}-${safe}`
  const dest = join(dir, filename)
  writeFileSync(dest, Buffer.from(data))
  const res = getDb()
    .prepare(
      `INSERT INTO backups (filename, kind, note, size, created_by, created_at)
       VALUES (?, 'import', ?, ?, ?, ?)`
    )
    .run(filename, 'Kullanıcı tarafından içe aktarıldı', statSync(dest).size, createdBy, Date.now())
  return getBackup(Number(res.lastInsertRowid))!
}

/**
 * GERİ YÜKLE — mevcut DB önce 'safety' yedeği olarak saklanır, seçilen yedek
 * bayrak dosyasında bekletilir ve uygulama yeniden başlatılır. Yeniden açılışta
 * initDatabase bayrağı görür, DB dosyasını değiştirir (bkz. applyPendingRestore).
 */
export function restoreBackup(id: number): void {
  const db = getDb()
  const row = db.prepare('SELECT id, filename FROM backups WHERE id = ?').get(id) as
    | { id: number; filename: string }
    | undefined
  if (!row) throw new Error('Yedek bulunamadı')
  const source = join(getBackupsDir(), row.filename)
  if (!existsSync(source)) throw new Error(`Yedek dosyası yok: ${row.filename}`)

  // Muhafaza: geri yüklemeden önce mevcut veriyi de yedekliyoruz.
  mkdirSync(getBackupsDir(), { recursive: true })
  const safetyName = `yazar-kasa-once-${stamp()}.db`
  const safetyPath = join(getBackupsDir(), safetyName)
  db.pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(getDbPath(), safetyPath)
  db.prepare(
    `INSERT INTO backups (filename, kind, note, size, created_by, created_at)
     VALUES (?, 'safety', 'Geri yükleme öncesi muhafaza', ?, NULL, ?)`
  ).run(safetyName, statSync(safetyPath).size, Date.now())

  writeFileSync(getRestorePendingPath(), source, 'utf8')
  app.relaunch()
  app.exit(0)
}