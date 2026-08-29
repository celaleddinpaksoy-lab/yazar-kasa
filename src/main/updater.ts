import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

export function setupAutoUpdater(): void {
  // Geliştirme modunda güncelleme çalışmaz; sadece paketlenmiş sürümde açık.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[güncelleme] hata:', err instanceof Error ? err.stack || err.message : String(err))
  })
  autoUpdater.on('checking-for-update', () => console.log('[güncelleme] kontrol başladı'))
  autoUpdater.on('update-available', (i) => console.log('[güncelleme] yeni sürüm bulundu:', i?.version))
  autoUpdater.on('update-not-available', (i) => console.log('[güncelleme] güncel sürüm kullanılıyor:', i?.version))
  autoUpdater.on('download-progress', (p) => console.log(`[güncelleme] indirme %${Math.round(p.percent)}`))
  autoUpdater.on('update-downloaded', (i) => console.log('[güncelleme] indirildi, yeniden başlatınca kurulacak:', i?.version))

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[güncelleme] kontrol çağrısı başarısız:', err)
  })
}