# AGENTS.md

Yazar kasa (POS) + stok + borç/taksit uygulaması. **Durum: Adım 11 (son geliştirme adımı) tamam — Yedekleme (günlük otomatik açılışta + manuel tek tık + içe aktarma + geri yükleme: önce Muhafaza yedeği, bayrakla relaunch, açılışta swap), fiş/etiket yazdırma (@media print), güncelleme notu/e-altyapı (paketli sürümde electron-updater), uçtan uca defter tutarlılık testi geçti. Dağıtım: CI (`v*` tag) **Windows** paketini üretip GitHub Releases'e yükler; macOS üretimi şu an KAPALI** (CI'daki mac işi yoruma alındı; geri açılırsa `scripts/macos-selfsign.sh` ile self-signed imzalı paket üretilir).**

## Başlamadan önce OKU
- **`PLAN.md`** — kapsam, modüller ve davranış kurallarının tek kaynağıdır. Kod yazmadan önce mutlaka oku. Plana aykırı kararlar verme; emin değilsen kullanıcıya sor.
- Kullanıcı Türkçe konuşur; arayüz metinleri Türkçe olmalıdır.
- **Para = INTEGER kuruş** (asla float!). Görüntülemede TL'ye çevrilir. Stok miktarı REAL'dir.

## Komutlar
- `npm run dev` — dev modda başlat (main/preload/renderer + Electron penceresi açılır)
- `npm run build` — üretim kodu üretir (`out/`)
- `npm run typecheck` — **her iş değişikliğinden sonra çalıştır** (node + web iki tsconfig doğrular)
- `npm run rebuild` — native modül yeniden derleme (better-sqlite3; electron sürümü değişince gerekir)
- `npm run build:win` / `build:mac` / `build:linux` — electron-builder ile dağıtım paketi (`release/`)
- Gateway: `npm run dev` başlatmada "Electron uninstall" hatası verirse: `node node_modules/electron/install.js` çalıştır (ikiil indirilmedi demektir).

## Yapı
- `electron-vite` projesi: `src/main` (ana süreç), `src/preload`, `src/renderer` (React), `src/shared` (IPC tipleri, `@shared/*` alias).
- Tek taraflı IPC: renderer → preload (`window.api`) → `src/main/ipc.ts` handler'lar.
- Veri dizini/DB yolu: `src/main/db.ts` → `app.getPath('userData')` (asla proje yoluna sabitleme).
- Güncelleme: `src/main/updater.ts` (sadece `app.isPackaged` iken çalışır).
- **Veritabanı:** `src/main/database.ts` (açılış) + `src/main/schema.ts` (DDL, `CREATE TABLE IF NOT EXISTS`) + `src/main/repositories/` (üye repo'ları). Değişiklikler schema üzerinden yapılır; `initDatabase()` uygulumada hazır olduktan sonra çağrılır.
- **Rapor/Dashboard:** `src/main/services/reports.ts` (`periodReport`, `dashboardSummary`; kâr = satış marjı − iade marjı + değişim farkı marjı). IPC: `dashboard:summary`, `reports:period`.
- **Yedekleme:** `src/main/repositories/backups.ts` — yedekler `userData/backups/`, günlük otomatik `scheduleDailyAutoBackup()` (boot'ta), geri yükleme bayrak dosyası `.restore.pending` yazar + `app.relaunch()`; açılışta `applyPendingRestore()` (`database.ts`) dosyayı değiştirir.
- **Tek stok kapısı:** `src/main/services/stock.ts` — stoku değiştiren her yer `setStock`/`adjustStock` kullanmalı, doğrudan UPDATE yok.
- **Barkod:** `src/shared/barcode.ts` (EAN-13 kontrol basamağı, otomatik üretim) — arayüzde `jsbarcode` ile SVG çizilir (`ProductsPage.tsx`'te `BarcodeSvg` bileşeni; 13 haneli → EAN13, değilse CODE128). Ürün barkodu boş bırakılırsa id'den deterministik EAN-13 üretilir.
- **Kimlik/oturum:** şifre `scrypt` (salt:hash); oturum `src/main/ipc.ts` içinde `session` değişkeninde tutulur. Default admin: **admin / admin** (ilk girişte Ayarlar → şifre değiştir).

## Kritik iş kuralları (kod yazarken asla bozma)
- **Entegrasyon/senkronizasyon ürünün kalbidir:** her işlem atomik tek transaction (stok + fiş + ödeme + borç + rapor aynı anda). "Stok düştü ama fiş yazılmadı" olmamalı. Veri değişince tüm ekranlar otomatik yenilenmeli (manuel refresh yok).
- **Tek stok kapısı:** stok artış/azalışı tek servis üzerinden — satış, iade, değişim, alış, tedarikçi iadesi hep oradan geçer.
- Negatif stok ENGEL lenir (izinsiz satış yok).
- Eksik ödeme → kayıtlı müşteri: borç + fişe yansır; anonim: uyarı + engel.
- **Veresiye gizliliği:** Personel borçları görebilir ama DÜZENLEYEMEZ (salt okunur). Admin tam yetki.
- Manuel borç/alış düzenlemesi (ekle/düzenle/sil) müşteri ve tedarikçi tarafında serbest; manuel kayıtlar ayrı işaretlenir, stok/raporu sanki otomatik gibi bozmaz.
- İade: stok (+), dashboard (−). Değişim: stok A(+) B(−), raporlarda ayrı "Değişim" kalemi.
- Barkod hem okunur hem üretilir; etiket şablonu (ad + barkod + fiyat).

## Yap ve doğrula
- Kod geliştirme, `PLAN.md`'deki **"Geliştirme Sırası"**na sadık kalmalı (1. kurulum iskeleti → 11. final test).
- Her değişiklikten sonra `npm run typecheck` (+ gerekiyorsa `npm run build`). Dev modda `npm run dev` ile elle kontrol.
- Güncelleme mekanizması SQLite verisine DOKUNMAMALI.
- **Reactive sync:** veri değiştiren HER yeni IPC handler'ı başarılı sonucunda `broadcastDataChanged()` çağırmalı (`ipc.ts`). Renderer sayfaları load effect'inde `useDataVersion()` (`context/DataContext.ts`) bağımlılığını kullanır.

## Kritik iş kuralları (kod yazarken asla bozma)
- **Entegrasyon/senkronizasyon ürünün kalbidir:** her işlem atomik tek transaction (stok + fiş + ödeme + borç + rapor aynı anda). "Stok düştü ama fiş yazılmadı" olmamalı. Veri değişince tüm ekranlar otomatik yenilenmeli (manuel refresh yok).
- **Tek stok kapısı:** stok artış/azalışı tek servis üzerinden — satış, iade, değişim, alış, tedarikçi iadesi hep oradan geçer.
- Negatif stok ENGEL lenir (izinsiz satış yok).
- Eksik ödeme → kayıtlı müşteri: borç + fişe yansır; anonim: uyarı + engel.
- **Veresiye gizliliği:** Personel borçları görebilir ama DÜZENLEYEMEZ (salt okunur). Admin tam yetki.
- Manuel borç/alış düzenlemesi (ekle/düzenle/sil) müşteri ve tedarikçi tarafında serbest; manuel kayıtlar ayrı işaretlenir, stok/raporu sanki otomatik gibi bozmaz.
- İade: stok (+), dashboard (−). Değişim: stok A(+) B(−), raporlarda ayrı "Değişim" kalemi.
- Çekim/barkod: barkod hem okunur hem üretilir; etiket şablonu (ad + barkod + fiyat).

## Yap ve doğrula
- Kod geliştirme, `PLAN.md`'deki **"Geliştirme Sırası"**na sadık kalmalı (1. kurulum iskeleti → 11. final test).
- Kurulum tamamlanınca README/komutlar oluşur; proje iskeleti çıkınca bunları AGENTS.md'ye işleyin.
- Güncelleme mekanizması SQLite verisine DOKUNMAMALI.

## Dağıtım/transfer (kritik)
- Uygulama **bu makinede kurulmayacak** (burası sadece geliştirme/test). Asıl kurulum yeri ayrı bir makinedir; uygulama oraya **flash / bulut / harici ortam** ile götürülür.
- Bu nedenle:
  - SQLite veritabanı **asla proje/derleme yoluna sabitlenmez**; her makinede `app.getPath('userData')` altında çalışma zamanında oluşturulur.
  - Derlemede **taşınabilir (portable)** hedef olmalı — kopyalanınca çalışan, kurulum gerektirmeyen sürüm.
  - Yedek al/geri yükle (dosya olarak) veriyi makineden makineye taşımanın resmi yoludur.
- **Windows paketi bu macOS'ta üretilemez** (better-sqlite3 kaynaktan çapraz derlenmez ve v13 için prebuilt yok). Windows paketi yalnızca Windows tarafında veya `.github/workflows/release.yml` (GitHub Actions, ücretsiz) ile üretilir: `v*` etiketi itilince Windows build yapılır + GitHub Releases'e yüklenir (publish owner/repo'yu `github.repository`'den alır).
- **macOS destek şu an KAPALI** (hedef Windows). CI'daki mac işi yoruma alındı; geri açılırsa: `macarm64` işi `scripts/macos-selfsign.sh` ile self-signed kimlik kurar (`CSC_NAME=YazarKasa Self-Signed`) ve imzalı DMG/ZIP üretir ("hasar görmüş" hatası olmaz, ilk açılışta sağ tık→Aç gerekir).
- Yerel macOS paketi: `npm run build:mac` → `release/*.dmg` + `.zip` + `latest-mac.yml`.

## Kurulu sürümler (2026-08)
Electron ^44 · electron-vite ^5 · Vite ^7 · React ^19 · TS ^5.9 · better-sqlite3 ^13 (arm64 derlendi) · electron-builder ^26. build config: `electron-builder.yml` (Windows: nsis + **portable**; publish: GitHub provider, owner/repo git origin'den otomatik). CI: `.github/workflows/release.yml` → `v*` tag'de her platform build + GitHub Releases'e publish (public repo olmalı).