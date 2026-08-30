# AGENTS.md

Yazar kasa (POS) + stok + borç/taksit + alacak-verecek defteri. Electron ^44 · electron-vite ^5 · React ^19 · TS ^5.9 · better-sqlite3 ^13 · electron-builder ^26. Tek makinede yerel masaüstü uygulaması; arayüz **Türkçe** (kullanıcı Türkçe konuşur).

**Durum:** Adım 11 (son geliştirme adımı) tamam — yedekleme, yazdırma, otomatik güncelleme altyapısı, defter tutarlılık testi geçti. Dağıtım Windows (CI). macOS üretimi KAPALI.

## Başlamadan önce oku
- **`PLAN.md`** — kapsam, modüller ve davranış kurallarının tek kaynağı. Kod yazmadan önce oku; plandan saparsan kullanıcıya sor.

## Veri tipleri (yazarken asla atlama — renderer'da TL'ye çevrilir)
- Para: **INTEGER kuruş** (float YASAK)
- Stok miktarı: REAL
- Zaman: INTEGER ms
- Günler: TEXT `YYYY-MM-DD`

## Komutlar
- `npm run dev` — dev modda başlat (pencere açılır)
- `npm run typecheck` — node + web iki tsconfig; **her değişiklikten sonra zorunlu**
- `npm run build` — üretim kodu (`out/`)
- `npm run build:win` / `build:mac` / `build:linux` — electron-builder dağıtım paketi (`release/`)
- `npm run rebuild` — native modülü Electron ABI'sine yeniden derler (better-sqlite3; electron sürümü değişince gerekir)
- `npm install` → `postinstall` (electron-builder install-app-deps) native'i otomatik yeniden derler
- `npm test` — vitest servis testleri (geçici veri dizininde çalışır, Electron/veriye dokunmaz; `tests/`)
- Dev açılışta "Electron uninstall" hatası → `node node_modules/electron/install.js` (ikil inmişmedi).

## Mimari
- `electron-vite`: `src/main` (ana süreç), `src/preload`, `src/renderer` (React), `src/shared` (`@shared/*` alias, IPC tipleri).
- Tek yönlü IPC: renderer → preload `window.api` → `src/main/ipc.ts`. Oturum, `ipc.ts` içindeki `session` değişkenindedir.
- DB: `src/main/db.ts` (yol = `app.getPath('userData')` — **asla proje yoluna sabitleme**), `database.ts` (açılış + pending restore), `schema.ts` (DDL `CREATE TABLE IF NOT EXISTS`), `repositories/` (repo'lar, transaction'lar burada).
- **Reactive sync:** veri değiştiren HER yeni IPC handler'ı başarılı sonucunda `broadcastDataChanged()` çağırmalı; sayfalar `useDataVersion()` (`context/DataContext.ts`) ile yüklenir. Unutursan ekranlar yenilenmez. (Mevcut mutatörlerin hepsi çağırıyor.)
- **Tek stok kapısı:** `src/main/services/stock.ts` — stoku değiştiren her yer `setStock`/`adjustStock`; doğrudan `UPDATE stock` YASAK.
- Kâr formülü (`services/reports.ts`): satış marjı − iade marjı + değişim farkı marjı. IPC: `dashboard:summary`, `reports:period`.
- Yedekleme (`repositories/backups.ts`): `userData/backups/`, günlük otomatik `scheduleDailyAutoBackup()` (boot'ta); geri yükleme `.restore.pending` bayrağı + `app.relaunch()`, açılışta `applyPendingRestore()` atomik swap yapar.
- Güncelleme (`updater.ts`): yalnızca `app.isPackaged`; her açılışta `checkForUpdatesAndNotify()` → otomatik indir, kapanınca kur. SQLite verisine hiç dokunmaz.
- Barkod (`shared/barcode.ts`): EAN-13 kontrol basamağı; ürün barkodu boşsa id'den deterministik EAN-13. SVG çizim `ProductsPage.tsx` `BarcodeSvg` (13 hane → EAN13, değilse CODE128).
- Kimlik: şifre `scrypt` (salt:hash). Default: **admin/admin** (tam yetki), **personel/personel** (satış/iade; borç ve alış salt-okur).

## Kritik iş kuralları (asla bozma)
- Her işlem **atomik tek transaction** (stok + fiş + ödeme + borç + rapor birlikte); "stok düştü ama fiş yazılmadı" olamaz.
- Negatif stok engellenir.
- Eksik ödeme: kayıtlı müşteri → borç + fişe işlenir; anonim → uyarı + engel.
- Personel borç ve alışta **salt-okur**; admin tam yetki.
- Manuel borç/alış (ekle/düzenle/sil) ayrı işaretlenir, stok/raporu bozmaz.
- İade: stok (+), dashboard (−). Değişim: A(+)/B(−), raporlarda ayrı "Değişim" kalemi.
- Tedarikçi bakiyesi **türetilmiş** değerdir (Σalış + Σborç kaydı − Σödemeler) — elle yazma, servisten oku.
- Güncelleme mekanizması veritabanına DOKUNMAMALI.

## Dağıtım ve güncelleme
- Hedef **Windows** (nsis + portable). **Windows paketi bu Mac'te üretilemez** (better-sqlite3 çapraz derlenmez, v13 prebuilt yok) → Windows tarafı veya CI.
- CI: `.github/workflows/release.yml` — `v*` tag itilince Windows build (`--publish never`) yapar, tek `publish` işi `gh release create/upload --repo $GITHUB_REPOSITORY` ile tek release oluşturur. Repo **public** olmalı.
- **Release akışı:** kodu değiştir → `package.json` **version'ı artır** (0.1.x) → typecheck → commit + push → `git tag v0.1.x && git push origin v0.1.x` . 🚨 Sürüm aynı kalırsa kurulu PC'deki auto-update yeni sürümü yok sayar (güncelleme olmaz).
- Kurulu PC: her açılışta kontrol eder, indirir, kapanınca kurar. Yakalızca **kurulum (NSIS)** sürümü otomatik güncellenir; **portable elle indirilir**.
- macOS KAPALI: CI'da mac işi yoruma alındı (geri açmak için runner + `scripts/macos-selfsign.sh` + `CSC_NAME=YazarKasa Self-Signed` adımları yorumda duruyor). Yerelde `npm run build:mac` bu kimlik kuruluysa imzalı paket üretir.
- Veri taşıma/saklama: yedek al → dosya → hedef makinede içe aktar/geri yükle. DB her makinede çalışma zamanında `userData` altında oluşur.

## Doğrulama rutini
- Her değişiklikten sonra `npm run typecheck`; mantıklıysa `npm run build` ve `npm run dev` ile elle kontrol. `npm test` servis düzeyinde hızlı doğrulama sağlar (satış/stok, iade+değişim ortak limit, tedarikçi bakiyesi, fiş arama, v5 migrasyonu).
- Testler `tests/helpers.ts` üzerinden `YAZAR_KASA_DATA_DIR` ile geçici dizine veri yazar (dosya başına worker izolasyonu) ve bitince temizler; üretim verisine dokunmaz.
- `npm test` ve `npm run dev`/paketlenmiş uygulama aynı `better-sqlite3` build'ini kullanır (Node v22 ABI = Electron 44 ABI; `npm install` postinstall ikisini de taze tutar).