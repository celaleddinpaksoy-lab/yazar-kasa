# Yazar Kasa + Stok + Borç/Taksit Sistemi — FİNAL PLAN

Tarih: 2026-08-29 · Durum: **Adım 11 (Yedekleme + önizleme + güncelleme + final test) tamamlandı — Yedekleme (açılışta günlük otomatik + manuel tek tık + dosyadan içe aktarma + listeden geri yükleme; geri yükleme öncesi mevcut veri "Muhafaza" yedeğine alınır ve uygulama yeniden başlatılır), fiş/etiket yazdırma (@media print), uzaktan güncelleme notu/merkezi (paketli sürümde electron-updater), uçtan uca defter tutarlılık testleri. Uygulama v1'e hazır — dağıtım öncesi tek eksik: electron-builder.yml `owner` alanı (sıradaki adım: dağıtıme)**

> Not: İadeyi hem admin hem personel yapabilir (kimlik created_by ile izlenir). Otomatik satış kaydı düzenlenemez. Nakit elden iadeler kasa dengesinde netleştirilir (giriş−iade).
> Not 2: Migrasyon sistemi koşullu fonksiyon bazlı (mevcut v4: purchases.kind + zaman indeksleri). Tedarikçi bakiyesi saklanmaz, sorgu anında türetilir (tutar değil, toplamlar üzerinden) — yanlış bakiye riski yok.
> Not 3: Tedarikçi/alış mutasyonları (ekle/düzenle/sil/borç/ödeme) yalnızca **admin**; personel salt okur. Alışta nakit peşin ödeme kasadan **çıkar** (sale_payments kind=expense) ve kasa net nakit hesabına girer.
> Not 4: **Reactive sync tamamlandı** — main süreç her atomik işlem sonrası `data:changed` (sürüm no) yayınlar; tüm ekranlar bu sürümü izleyip ilgili verilerini yeniler (manuel refresh yok).
> Not 5 (rapor): Kâr = satış marjı − iade marjı + değişim farkı marjı; tedarikçi/alış mutasyonları admin. Raporlar nakit akışını `date` (yerel gün), işlemleri `created_at` ile dilimler; dönüş aralıkları yerel saate göre.
> Not 6 (yedekleme): Yedekler `userData/backups/` altında SQLite dosyası; her açılışta günde bir otomatik (son 30 tutulur). Geri yükleme: seçili yedeğe önce "Muhafaza" kaydı düşülür, bayrak dosyası yazılır, uygulama yeniden başlar; açılışta veri dosyası değiştirilir (WAL/SHM kalıntıları temizlenir), şema migrasyonla tazelenir. Otomatik yedek `scheduleDailyAutoBackup` ile boot zamanında.
> Not 7 (dağıtım): Paket üretimi `.github/workflows/release.yml` (GitHub Actions) ile — `v*` etiketi itilince macOS (arm64+x64) ve Windows (nsis+portable) derlenir, GitHub Releases'e yüklenir (public repo → uygulama güncellemeyi token'sız alır; publish owner/repo git origin'den çekilir). Yerel yalnızca macOS arm64 paketlenebilir (better-sqlite3 çapraz derlenmez). Kurulu makinelerde uygulama auto-update ile yeni etiketleri bulur.

Bu dosya, uygulamanın müşteri tarafıyla görüşülerek netleştirilmiş **kapsam ve davranış planıdır**. Kod yazılmadan önce son hali budur. Değişiklik olursa bu dosya da güncellenir.

## Teknoloji
- Electron + React + SQLite (TypeScript)
- Barkod üretimi: `jsbarcode`
- Güncelleme: `electron-updater` + GitHub Releases (otomatik, veritabanına dokunmaz)
- Fiyatlar: **KDV dahil** (sade, vergi ayrı hesaplanmaz)
- Veri: tek makinede yerel SQLite (tek dosya)

## Roller
- **Admin:** Tam yetki (borç & alış düzenleme, silme, raporlar, yedekleme, ayarlar)
- **Personel:** Satış, ürün arama, fiş, **borçları görüntüleme (salt okunur)**, sınırsız indirim

## Modüller
1. **Login** — rol bazlı erişim
2. **Dashboard** — günlük satış, ciro, kâr, iade, değişim, düşük stok, toplam alacak/verecek, gecikmiş/vadesi yaklaşan taksit uyarıları, satış grafiği
3. **Satış/Kasa** — kategorilere tıkla → ürünler, ürün arama, barkod okuma, sepet (ürün **miktar & fiyat düzenleme**), **Beklet (müşteri bekletme)**, **indirim** (ürün bazlı + toplam), ödeme tipleri (nakit/kart/havale), **eksik ödeme** → kayıtlı müşteri: borç + fişe yansıma / anonim: uyarı + engel, **negatif stok engeli**, fiş önizleme (anonim + borçlu müşteri 2 şablon)
4. **Kasa Açılış/Kapanış** — gün başı para girilir, gün sonu sayım; **beklenen vs fiili karşılaştırma**
5. **İade** — satış iadesi + sadece-iade; sonuç seçenekli: (*borçtan düş / elden iade / karışık*); stok (+) ve dashboard (−) otomatik
6. **Değişim** — ürün değişimi; stok A(+) B(−); raporlarda **ayrı "Değişim" kalemi**; iade edilen ve yeni satılan **ayrı satırlar**; fark ödemesi (nakit/kart/havale/borca)
7. **Kategoriler & Ürünler** — CRUD, barkod **oluşturma**, **etiket şablonu** (ad + barkod + fiyat), alış/satış fiyatı, stok, isterse ürün fotoğrafı (opsiyonel)
8. **Stok / Alış Defteri** — tedarikçi + ürün + adet + birim fiyat → stok artar; **tam manuel kontrol** (alış ekle/düzenle/sil); tedarikçi iadesi
9. **Tedarikçiler** — kayıt, verecek/borç takibi, ödeme geçmişi (tipli), **manuel borç ekle/düzenle/sil**
10. **Müşteriler** — kayıt, borç takibi, **ödeme geçmişi bölümü** (tipli; toplam satış − ödenen = kalan otomatik), **manuel borç ekle/düzenle/sil**, **taksit vade günü + hatırlatma**
11. **Müşteri Borç Geçmişi Raporu** — tarih, açıklama, tutar, tip, bakiye; tek müşteri veya tüm liste
12. **Borç/Alacak Defteri** — müşteri bazlı bakiye ekranı
13. **Raporlar** — Günlük/Haftalık/Aylık/6 Aylık/Yıllık; **dönemin üzerine tıkla → o dönemin detayı**: toplam satış, ciro, ürün-ürün satılan adetler, ödemeler, iadeler, değişimler, kâr
14. **Yedekleme** — **günlük otomatik** + tek tıkla manuel yedek al / geri yükle
15. **Fiş & Etiket önizleme** — şimdi ekranda; yazıcı (termal) destek altyapısı sonraya hazır
16. **Uzaktan Güncelleme** — GitHub Releases üzerinden otomatik

## Entegrasyon / Senkronizasyon / Optimizasyon (İşin Kalbi)
Bu kısım ürünün en önemli gerekliliğidir. İskeletten itibaren mimariye gömülür:

1. **Tek doğru veri kaynağı:** Tüm veri tek SQLite veritabanında. Hiçbir ekranın bağımsız kopyası yoktur; her ekran DB'den sorgular.
2. **Atomik işlemler (ACID transaction):** "Satışı Tamamla" tek atomik blokta yürütür: stok düş + fiş + ödeme + borç + rapor verisi. Adımlardan biri hata verirse **hiçbiri** uygulanmaz. "Stok düştü ama fiş yazılmadı" imkânsız olmalı.
3. **Otomatik yayın (reactive sync):** İşlem tamamlanınca "veri değişti" sinyali tüm açık ekranlara (dashboard, stok, borç defteri, tedarikçi) anında gider; manuel yenileme gerekmez.
4. **Tek stok kapısı:** Stok artış/azalışı tek servis üzerinden. Satış, iade, değişim, alış, tedarikçi iadesi hep aynı kapıdan geçer. Kayıp/çift düşme olamaz.
5. **Kimlik & izlenebilirlik:** Her hareket kimlik + kaynak (satış/iade/manuel) ile işaretlenir; aynı işlem iki kez uygulanamaz.
6. **Optimizasyon:** Sık sorgulanan alanlara index (tarih, barkod, müşteri, fiş no); dashboard için özet tablo (büyüse bile hızlı).

## Önemli Davranış Kararları
- **Satış iptali (sepetteyken):** Stok ve dashboard etkilenmez (henüz gerçekleşmemiş).
- **İade (fiş kesildikten sonra):** Stok geri (+), dashboard satış/ciro/kâr (−) — tutarlı.
- **Değişim:** Stok A(+) B(−), ayrı "Değişim" kalemi, iade+satış ayrı satırlar.
- **Eksik ödeme:** Kayıtlı müşteri → borç + fişe yansır; anonim → uyarı + borç için kayıt zorunlu.
- **Negatif stok:** Stoktan fazla satış denendiğinde engellenir.
- **Veresiye gizliliği:** Personel borçları **görebilir** ama **değiştiremez**; fiş şablonları anonim/borçlu farklıdır (detay müşteri ile netleştirilecek).

## Veritabanı Tabloları (taslak)
`users` · `categories` · `products` · `suppliers` · `customers` · `purchases` + `purchase_payments` · `sales` + `sale_items` + `sale_payments` (nakit/kart/havale) · `debt_movements` (borç/ödeme/manuel) · `returns` · `exchanges` · `holds` (beklet) · `backups`

## Geliştirme Sırası
1. Kurulum iskeleti (Electron + React + SQLite + auto-update) → 2. Veritabanı + Login/roller → 3. Kategoriler + Ürünler + Barkod + Etiket → 4. Satış/Kasa (indirim, beklet, sepet düzenleme, fiş) → 5. Kasa açılış/kapanış → 6. Müşteri + borç/taksit + ödeme geçmişi + manuel borç + hatırlatma → 7. İade → 8. Değişim → 9. Stok + Alış + Tedarikçi defteri (+ plan dışı küçük: **Ayarlar/şifre değiştirme**, her adımda **reactive sync**) → 10. Dashboard + Raporlar + Borç Defteri → 11. Yedekleme + önizleme + güncelleme + test (+) → dağıtım (owner alanı doldur, build:win/mac, flash/bulut ile asıl makineye taşımak)

## Not
- Cihazlar arası eşzamanlı (çoklu makine) çalışma şu an kapsam dışıdır; tek makine, farklı oturumlar. İleride çoklu cihaz istenirse ayrı sunucu/mimari planlanır.
- Güncelleme yalnızca program kodunu değiştirir; SQLite verisi (stok/satış/borç/müşteri) asla etkilenmez.
- **Dağıtım:** Uygulama bu geliştirme makinesine KURULMAZ (burası yalnızca test). Asıl kurulum ayrı makinede; uygulama oraya **flash/bulut/harici ortam** ile taşınır. Bu yüzden: veritabanı her makinede `userData` altında oluşturulur (projeye sabitlenmez), taşınabilir (portable) derleme hedefi olmalı, yedek al/geri yükle dosya ile makineden makineye taşımada ana yol.