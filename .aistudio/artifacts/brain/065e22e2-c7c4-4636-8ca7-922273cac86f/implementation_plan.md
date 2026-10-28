# Tek Tıkla "Tam Proje Arşivi (.zip)" Dışa & İçe Aktarma Planı (HMAC Korumalı)

## 1. Kullanıcı Talebi ve Güvenlik Hedefi
Kullanıcı, dışa aktarılan ve içeri aktarılan `.zip` arşiv paketinin tamamına **HMAC koruması** uygulanmasını; orijinal dosyalarda ve ham RINEX ölçülerinde harici herhangi bir tahrifat/değişiklik yapılmasına karşı kesin koruma sağlanmasını talep etmektedir.

Yapılan netleştirmeler ve güvenlik ilkeleri:
- **Paket İçeriği:** İmzalı `proje_verileri.json` + `archive_manifest.json` (HMAC imzalı kriptografik dosya listesi) + OPFS ham RINEX dosyaları (`.obs`, `.24o`, `.nav`) + BÖHYY Dengeleme Özeti (`dengeleme_ozeti.txt`) + `README_ARSIV.txt`.
- **Uçtan Uca HMAC Koruma Zinciri:**
  1. Arşivdeki her bir dosyanın (ham RINEX dosyaları dahil) kriptografik SHA-256 hash özeti hesaplanır.
  2. Dosya listesi, boyutları ve hash'leri içeren `archive_manifest.json` oluşturulur.
  3. Manifestoya gizli anahtarlı **HMAC-SHA256** dijital imzası uygulanır.
- **İçe Aktarmada Bütünlük Doğrulaması (Anti-Tamper Verification):**
  - ZIP açıldığında önce `archive_manifest.json` dosyasının HMAC imzası denetlenir.
  - Ardından arşivdeki her bir ham dosya (RINEX gözlemleri, navigasyon ve json verisi) tek tek hash kontrolünden geçirilir.
  - Herhangi bir dosyada 1 bayt dahi değişiklik yapılmışsa, dosya silinmiş veya eklenmişse içe aktarma derhal durdurulur ve kullanıcıya net bir tahrifat uyarısı verilir.
- **Çalışma Prensibi:** `jszip` ile istemci tarafında %100 yerel, çevrimdışı ve tarayıcı belleğini koruyan akışlı işlem.

---

## 2. Mimari, Ergonomi ve Tasarım Kararları

### 2.1. Güvenli ZIP Arşiv Hiyerarşisi
```text
[PROJE_ADI]_GNSS_Arsivi.zip
├── archive_manifest.json        # HMAC-SHA256 imzalı kriptografik dosya listesi & SHA-256 hash'leri
├── proje_verileri.json          # Proje ayarları, koordinatlar, bazlar ve dengeleme sonuçları
├── dengeleme_ozeti.txt          # BÖHYY dengeleme karnesi ve duyarlık göstergeleri
├── README_ARSIV.txt             # Arşiv künyesi ve doğrulama sertifika bilgisi
└── rinex/                       # Orijinal ham RINEX dosyaları
    ├── IST1.24o                 # 1. İstasyon ham gözlem dosyası
    ├── IST2.24o                 # 2. İstasyon ham gözlem dosyası
    ├── ROV1.24o                 # Rover ham gözlem dosyası
    └── brdc1200.24n             # Broadcast navigasyon dosyası
```

### 2.2. Kriptografik Manifest Yapısı (`archive_manifest.json`)
```json
{
  "app": "ACB Maps - Nirengi Hesabı & GNSS Arşiv Yöneticisi",
  "version": "1.0",
  "projectId": "project-1718000000",
  "projectName": "Bursa Nilüfer GNSS Ağı",
  "createdAt": "2026-10-25T10:00:00.000Z",
  "files": [
    {
      "path": "proje_verileri.json",
      "size": 45120,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "path": "rinex/IST1.24o",
      "size": 14205560,
      "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
    },
    {
      "path": "dengeleme_ozeti.txt",
      "size": 8420,
      "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    }
  ],
  "integrity": {
    "algorithm": "HMAC-SHA256",
    "signedAt": "2026-10-25T10:00:00.000Z",
    "totalFiles": 3
  },
  "signature": "a6c905b7... (HMAC-SHA256 İmzası)"
}
```

### 2.3. Doğrulama ve Güvenlik Kuralları
1. **İmza Kontrolü:** Manifestodaki `signature` değeri gizli anahtar ve normalize edilmiş manifest içeriğiyle doğrulanır.
2. **Hash Uyuşmazlığı Kontrolü:** ZIP içindeki her dosyanın baytları okunarak SHA-256 hash'i hesaplanır ve manifestodaki değerle karşılaştırılır.
3. **Ek Dosya / Eksik Dosya Kontrolü:** Arşivde manifestoda olmayan fazladan bir dosya varsa veya manifestoda geçen bir dosya silinmişse arşiv doğrudan geçersiz sayılır.
4. **Kullanıcı Bildirimi:** Başarılı doğrulamada yeşil kilit ikonu ve "Bütünlük Doğrulandı: Tüm ölçü ve dengeleme dosyaları orijinal ve değiştirilmemiştir" rozeti; tahrifat tespitinde ise kırmızı uyarı kalkanı ve değiştirilen dosya listesi sunulur.

---

## 3. Adım Adım Dosya Değişiklik Planı

### Adım 1: Bağımlılık Kurulumu
- `jszip` ve `@types/jszip` paketlerinin `install_applet_package` ile projeye eklenmesi.

### Adım 2: Kriptografik Fonksiyonların Genişletilmesi (`src/utils/backupIntegrity.ts`)
- `calculateFileSha256(file: File | Uint8Array): Promise<string>` fonksiyonunun eklenmesi (bayt bazlı akışlı hashleme).
- `signArchiveManifest` ve `verifyArchiveManifest` fonksiyonlarının oluşturulması.

### Adım 3: Güvenli Arşiv Yöneticisi Modülü (`src/utils/projectArchiveManager.ts`)
- `exportSecureProjectZipArchive(project, options, onProgress)`:
  - OPFS'deki ham RINEX dosyalarını toplama.
  - Her bir dosyanın SHA-256 hash'ini hesaplama.
  - Manifestoyu üretip HMAC-SHA256 ile imzalama.
  - ZIP arşivine dosyaları ekleyip kullanıcıya indirme bağlantısı üretme.
- `importSecureProjectZipArchive(zipFile, onProgress)`:
  - ZIP arşivini açma.
  - `archive_manifest.json` dosyasını çıkarma ve HMAC imzasını doğrulama.
  - Tüm dosyaların SHA-256 hash'lerini karşılaştırma.
  - Bütünlük sağlandıysa ham RINEX dosyalarını OPFS'e aktarma, proje JSON'unu sisteme yükleme.
  - Tahrifat varsa kullanıcıya hangi dosyanın değiştirildiğini belirten hata fırlatma.

### Adım 4: Kullanıcı Arayüzü Entegrasyonu (`src/components/HomeTab.tsx` & `src/App.tsx`)
- "Proje Yükle" modalına **"HMAC Korumalı Tam Proje Arşivi Yükle (.zip)"** butonu ve sürükle-bırak desteği.
- Arşiv yüklenirken açılan **Doğrulama ve İlerleme Modalı**:
  - Adım 1: HMAC İmza Doğrulaması.
  - Adım 2: Ham RINEX Ölçü Dosyaları Hash Kontrolü.
  - Adım 3: OPFS Yerel Diskine Güvenli Aktarım.
- Proje listesinde her satıra "Tam Arşiv İndir (.zip)" butonu.

### Adım 5: Raporlar Sekmesi Entegrasyonu (`src/components/ReportExportTab.tsx`)
- Raporlar sekmesine "Kriptografik HMAC Korumalı Proje Arşivi (.zip)" kartı eklenmesi.

---

## 4. Doğrulama ve Test Planı
1. **Derleme ve Tip Denetimi:** `lint_applet` (`tsc --noEmit`) ve `compile_applet` ile sıfır hata doğrulama.
2. **Normal Akış Testi:** Proje oluşturma, `.zip` olarak dışa aktarma ve ardından aynı `.zip` dosyasını geri yükleyip tüm istasyon ve OPFS RINEX dosyalarının başarıyla açıldığını teyit etme.
3. **Tahrifat / Değiştirilme Testi:** ZIP içindeki bir RINEX dosyasının veya JSON metninin 1 karakteri değiştirildiğinde sistemin bunu yakalayıp tahrifat uyarısı verdiğini ve projeyi yüklemeyi reddettiğini doğrulama.
