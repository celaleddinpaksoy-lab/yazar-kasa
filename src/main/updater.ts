import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync } from 'fs'
import { join } from 'path'

/** Güncelleme olaylarını userData/updates.log'a yazar — Windows kurulumunda
 * console görünmediği için "uygulama silindi / güncelleme başarısız" gibi
 * vakaları dosyadan teşhis etmeyi sağlar. Exception'lar bile bir sonraki
 * açılışta burada görülür. */
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try {
    appendFileSync(join(app.getPath('userData'), 'updates.log'), line + '\n', 'utf8')
  } catch {
    // log yazılamazsa sessiz geç; uygulama akışını asla bloklama
  }
}

export function setupAutoUpdater(): void {
  // Geliştirme modunda güncelleme çalışmaz; sadece paketlenmiş sürümde açık.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    log(`[güncelleme] hata: ${err instanceof Error ? err.stack || err.message : String(err)}`)
  })
  autoUpdater.on('checking-for-update', () => log('[güncelleme] kontrol başladı'))
  autoUpdater.on('update-available', (i) => log(`[güncelleme] yeni sürüm bulundu: ${i?.version}`))
  autoUpdater.on('update-not-available', (i) =>
    log(`[güncelleme] güncel sürüm kullanılıyor: ${i?.version}`)
  )
  autoUpdater.on('download-progress', (p) =>
    log(`[güncelleme] indirme %${Math.round(p.percent)}`)
  )
  autoUpdater.on('update-downloaded', (i) =>
    log(`[güncelleme] indirildi (${i?.version}); kurulum yeniden başlatmayla tetiklenecek`)
  )
  autoUpdater.on('update-cancelled', () => log('[güncelleme] kurulum kullanıcı tarafından iptal edildi'))

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log(`[güncelleme] kontrol çağrısı başarısız: ${err instanceof Error ? err.message : String(err)}`)
  })
}