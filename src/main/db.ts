import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

export const DB_FILE = 'yazar-kasa.db'
export const RESTORE_PENDING_FILE = '.restore.pending'
export const BACKUPS_DIR = 'backups'

/**
 * Veri dizini her makinede işletim sisteminin kullanıcı veri klasörüdür (userData).
 * Asla proje/derleme yoluna sabitlenmez — taşınabilir dağıtım bu sayede güvenlidir.
 * `YAZAR_KASA_DATA_DIR` ortam değişkeni verilirse (testler, taşınabilir/yedek
 * taşıma senaryoları) o yol kullanılır.
 */
export function getDataDir(): string {
  if (process.env.YAZAR_KASA_DATA_DIR) return process.env.YAZAR_KASA_DATA_DIR
  return app.getPath('userData')
}

export function getDbPath(): string {
  return join(getDataDir(), DB_FILE)
}

export function getBackupsDir(): string {
  return join(getDataDir(), BACKUPS_DIR)
}

export function getRestorePendingPath(): string {
  return join(getDataDir(), RESTORE_PENDING_FILE)
}

export function ensureDataDirectory(): void {
  mkdirSync(getDataDir(), { recursive: true })
}