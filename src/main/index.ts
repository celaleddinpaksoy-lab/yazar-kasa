import { app, BrowserWindow } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { initDatabase, closeDatabase } from './database'
import { registerIpcHandlers } from './ipc'
import { setupAutoUpdater } from './updater'
import { scheduleDailyAutoBackup } from './repositories/backups'

/**
 * Çalışma zamanı olaylarını userData/runtime.log'a yazar. Windows'da console
 * görünmediği için "pencere neden açılmadı / renderer çöktü mü" gibi vakalar
 * bu dosyadan teşhis edilir. (updates.log yalnızca güncellemeyi tutar.)
 */
function logLine(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try {
    appendFileSync(join(app.getPath('userData'), 'runtime.log'), line + '\n', 'utf8')
  } catch {
    // log yazılamazsa sessiz geç; uygulama akışını asla bloklama
  }
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'Yazar Kasa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  // 'ready-to-show' normalde ilk boyamada tetiklenir. Renderer takılır/çökerse
  // hiç tetiklenmez ve pencere görünmez — işlem Task Manager'da "arka plan"
  // altında kalır. Güvenlik ağı: 10sn sonra pencereyi yine de göster.
  const showFallback = setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      logLine('[window] ready-to-show gelmedi, pencere 10sn güvenlik ağıyla gösterildi')
      mainWindow.show()
    }
  }, 10_000)
  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallback)
    mainWindow.show()
  })
  mainWindow.on('closed', () => clearTimeout(showFallback))

  // Yükleme/çökme teşhisi + otomatik kurtarma
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logLine(`[window] yükleme hatası (${code} ${desc}): ${url}`)
  })
  let crashCount = 0
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logLine(`[window] renderer çöktü (${details.reason}), yeniden yükleniyor`)
    if (!mainWindow.isDestroyed() && crashCount < 5) {
      crashCount += 1
      mainWindow.reload()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Süreç en başında log — `whenReady` çalışmasa bile bu satır yazılır;
// "uygulama çalışıyor ama pencere açılmıyor" vakasında ana sürecin hangi
// aşamaya geldiği bu logdan birebir okunur.
try {
  appendFileSync(join(app.getPath('userData'), 'runtime.log'), `[${new Date().toISOString()}] [main] süreç başladı\n`, 'utf8')
} catch {
  // klasör/userData hazır değilse sessiz geç; aşağıdaki try/catch'ler yine yazar
}
logLine('[main] main modülü yüklendi, tek örnek kontrolü yapılıyor')

// Tek örnek: görev yöneticisinde arka planda sürüklenen eski bir işlem
// varken yeni başlatma işlem yapar; ikinci örnek kendi penceresini açıp
// mevcut pencereyi öne getirir, çifte/boş işlem yığını oluşmaz.
const hasLock = app.requestSingleInstanceLock()

if (!hasLock) {
  logLine('[main] tek örnek kilidi alınamadı, süreç kapatılıyor (ikinci örnek)')
  app.quit()
} else {
  app.on('second-instance', () => {
    logLine('[main] ikinci örnek algılandı — mevcut pencere öne getiriliyor')
    const win = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && !w.isMinimized() && w.isVisible()
    )
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } else if (app.isReady()) {
      logLine('[main] görünür pencere yok, yeni pencere açılıyor')
      createWindow()
    }
  })

  app.whenReady().then(() => {
    logLine('[main] app.ready oldu, veritabanı başlatılıyor')
    initDatabase()
    logLine('[main] veritabanı hazır, IPC/güncelleme/yedek kuruluyor')
    registerIpcHandlers()
    setupAutoUpdater()
    scheduleDailyAutoBackup()

    logLine('[main] pencere oluşturuluyor')
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    closeDatabase()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}