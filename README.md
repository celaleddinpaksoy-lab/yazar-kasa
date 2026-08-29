# YazarKasa

Yazar kasa (POS) + stok + borç/taksit + alacak-verecek defteri uygulaması.
Electron + React + SQLite (better-sqlite3), tek makinede çalışan yerel masaüstü uygulaması, Türkçe arayüz.

## Özellikler

- Satış/Kasa: sepete ekle, indirim, bekletme/kaldırma, fiş yazdırma, nakit + veresiye
- Kasa açılış/kapanış (günlük nakit sayımı)
- Kategoriler + Ürünler + barkod üretimi (EAN-13) + etiket yazdırma
- Müşteriler: borç / taksit / ödeme geçmişi / manuel borç / vade hatırlatmaları
- İade ve Değişim işlemleri (stok ve raporlara ayrı yansır)
- Tedarikçi defteri + Alış (stok girişi) + tedarikçi iadesi/ödemeleri
- Dashboard: bugün net ciro/kâr, düşük stok, vade uyarıları, 7 günlük grafik
- Raporlar: gün/hafta/ay/6 ay/yıl, ürün satışları, nakit akışı, gün detayı
- Borç/Alacak defteri: müşteri + tedarikçi bakiyeleri
- Yedekleme: günlük otomatik + manuel tek tık + dosyadan içe aktarma + geri yükleme (güvenli, yeniden başlatmayla)
- Roller: admin (tam yetki) / personel (satış, iade; borç ve alış salt-okur)

## Geliştirme

Ön koşul: Node.js 22+.

```bash
npm install
npm run dev        # geliştirme modunda başlat
npm run typecheck  # tip kontrolü (her değişiklikten sonra)
npm run build      # üretim kodu (out/)
npm run build:mac  # macOS paketi (release/)
npm run build:win  # Windows paketi (nsis + portable)
```

Default kullanıcı: **admin / admin** (Ayarlar → şifre değiştir).

Veri dizini: `app.getPath('userData')` (işletim sisteminin uygulama veri klasörü),
çalışma zamanında otomatik oluşturulur; yedekler `userData/backups/` altındadır.

## Dağıtım

- Paket üretimi `.github/workflows/release.yml` (GitHub Actions) ile yapılır:
  `v*` etiketi itildiğinde macOS (arm64 + Intel) ve Windows (nsis + portable)
  paketleri derlenir ve GitHub Releases'e yüklenir.
- Kurulu uygulamalar electron-updater ile yeni sürümleri otomatik bulur
  (repo public olmalı).
- Veriyi makineye taşımak: kaynak makinede **Yedek Al** → hedef makinede
  **Ayarlar → Yedekleme → dosyadan içe aktar / geri yükle**.

## Yapı

- `src/main` — Electron ana süreci (DB, IPC, iş servisleri)
- `src/preload` — güvenli köprü (contextIsolation)
- `src/renderer` — React arayüzü
- `src/shared` — IPC tipleri ve yardımcılar
- `PLAN.md` — kapsam, modüller ve davranış kuralları (tek kaynak)