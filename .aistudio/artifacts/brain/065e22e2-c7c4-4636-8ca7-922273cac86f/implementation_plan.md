# Yerli GNSS Taşıyıcı Faz Baz Çözücü (Native Baseline Processor) & Ağ Dengelemesi İş Planı

Topcon Tools veya harici ticari yazılımlara bağımlılığı tamamen ortadan kaldırarak, ham RINEX gözlemlerinden çift fark (Double-Difference) taşıyıcı faz baz vektörlerini ($\Delta X, \Delta Y, \Delta Z$) ve $3\times3$ varyans-kovaryans matrislerini bağımsız olarak çözen ve tek tıkla 3D ağ dengelemesine aktaran yerli GNSS çekirdeği mimarisi.

## Kullanıcı İncelemesi & Kritik Kararlar

> [!IMPORTANT]
> Kullanıcı ile yapılan ön görüşmede onaylanan mimari kararlar aşağıda özetlenmiştir:
> 
> * **Motor Mimarisi:** Tarayıcı ana iş parçacığını (UI thread) kilitlemeyen, arka planda paralel çalışan **İstemci Taraflı Web Worker GNSS Çözüm Motoru**.
> * **Yörünge Efemeris Stratejisi:** Hem saha anlık çözümleri için **RINEX Navigasyon (.nav / .n / .g Keplerian Efemeris)** hem de milimetrik jeodezik çözümler için **IGS Hassas Yörünge (.SP3)** hibrit desteği.
> * **Kullanıcı İş Akışı:** Tek tıkla ağdaki tüm bağımsız bazları otomatik tespit eden, çift fark faz çözümüyle belirsizlikleri sabitleyen (FIX) ve doğrudan 3D Gauss-Markov dengelemesine besleyen **"Tek Tıkla Tüm Ağı Çöz ve Dengele"** entegrasyonu.

---

## 1. Genel Bakış & Temel Konsept

Uygulama, bugüne kadar yalnızca bir **Ağ Dengeleme Motoru (Network Adjustment Engine)** olarak çalışmaktaydı ve baz vektörlerini RINEX başlığındaki yaklaşık tek nokta navigasyon koordinatlarından ($\sim 2\text{ m}$ hatalı `APPROX POSITION XYZ`) türetmekteydi. Bu durum Topcon Tools ile karşılaştırıldığında 2.07 metrelik yatay fark oluşturuyordu.

Bu iş planı ile uygulamaya **Bağımsız GNSS Taşıyıcı Faz Çift Fark Çözüm Çekirdeği (Carrier-Phase Double-Difference Engine)** entegre edilecektir:
1. Yüklenen RINEX `.obs` gözlem dosyalarından $L_1, L_2$ taşıyıcı fazları, $C_1, P_1, P_2$ kod ölçüleri okunacak ve epoklar ortaklaştırılacaktır.
2. Broadcast efemeris (Kepler denklemleri) veya IGS SP3 yörüngeleri üzerinden uyduların sinyal gönderme anındaki ECEF koordinatları tam zamanında hesaplanacaktır.
3. Çift fark faz denklemleri kurularak saat hataları ve atmosferik ortak gecikmeler elimine edilecektir.
4. **LAMBDA (Least-squares AMBiguity Decorrelation Adjustment)** algoritmasıyla tamsayı faz belirsizlikleri çözülecek ($R \ge 3.0$ ile **FIX** çözüme ulaşılacaktır).
5. Elde edilen gerçek baz vektörleri ($\Delta X, \Delta Y, \Delta Z$) ve $3\times3$ kovaryans matrisi doğrudan 3D En Küçük Kareler dengelemesine aktarılacaktır.

---

## 2. Kullanıcı Deneyimi & Arayüz Akışı

### A. Adım Adım Kullanıcı Akışı
1. **Veri Yükleme (Veri Girişi Sekmesi):**
   * Kullanıcı CORS ve Rover RINEX gözlem dosyalarını (`.o`, `.obs`) ve varsa Navigasyon (`.nav`, `.n`) veya IGS `.SP3` dosyasını yükler.
2. **Baz Vektörleri Sekmesi (Yeni Motor Arayüzü):**
   * **"Tek Tıkla Tüm Ağı Çöz ve Dengele"** butonu tetiklenir.
   * Web Worker arka planda çalışmaya başlar, UI kilitlenmeden canlı ilerleme çubuğu gösterilir (örneğin `%45 - BAN1 -> N.1002 bazı çözülüyor, 18 uydu, Ratio: 24.8 [FIX]`).
3. **Baz Çözüm Denetim Masası:**
   * Çözülen her baz için:
     * Durum: **FIX** (yeşil rozet) veya **FLOAT**
     * Doğrulama Oranı: **Ratio Test** ($R \ge 3.0$)
     * Koordinat Farkları: $\Delta X, \Delta Y, \Delta Z$ (m)
     * Mekansal Duyarlık: $\sigma = \sqrt{\sigma_X^2 + \sigma_Y^2 + \sigma_Z^2}$ (mm)
     * $3\times3$ Varyans-Kovaryans Detayları ($Q_{xx}, Q_{yy}, Q_{zz}, Q_{xy}, Q_{yz}, Q_{zx}$)
4. **Otomatik Dengeleme Geçişi:**
   * Çözülen bazlar 3D ağ dengelemesi sekmesine aktarılır; elde edilen nihai koordinatlar Topcon Tools sonuçlarıyla **milimetre düzeyinde** birebir örtüşür.

### B. Görsel Kimlik & Arayüz Standartları
* **Tipografi:** Koordinat, baz uzunluğu ve varyans değerlerinde `font-mono tabular-nums` kullanımı ile sarsıntısız sayısal hizalama.
* **Renk Paleti (60-30-10 Kuralı):**
  * %60 Nötr Zemin (`#F8FAFC` slate zemin)
  * %30 Yapısal Paneller (`#FFFFFF` kartlar, 1px `#E2E8F0` kılcal sınırlar)
  * %10 Odak Aksanları: FIX çözümler için zümrüt yeşili (`#059669`), hesaplama aksiyonları için derin kobalt (`#2563EB`).
* **Sıfır-Pill Disiplini:** Statik veriler sade metin ve tipografik ayraçlarla (`·`) sunulacak; pill/rozetler yalnızca tıklanabilir etkileşimli filtrelerde kullanılacaktır.

---

## 3. Ürün & Mimari Kararları (Trade-Offs)

| Karar | Seçilen Yaklaşım | Tercih Nedeni | Alternatif & Reddedilme Sebebi |
| :--- | :--- | :--- | :--- |
| **İşleme Ortamı** | İstemci Taraflı Web Worker | Kullanıcı verileri gizli kalır (KVKK/veri güvenliği), sunucu maliyeti sıfırdır, offline/çevrimdışı çalışır. | Sunucu tabanlı C servisi: Yüksek sunucu kiralama maliyeti ve veri aktarım gecikmesi yaratır. |
| **Faz Belirsizliği** | LAMBDA Algoritması | GNSS jeodezisinde dünya standardıdır; bağımsız faz belirsizliklerini köşegenleştirerek milimetrik FIX üretir. | Basit yuvarlama (Rounding): Uzun bazlarda (>10 km) hatalı tamsayı seçer ve santimetrelerce kaymaya neden olur. |
| **Yörünge Modeli** | RINEX Nav (.nav) + SP3 Hibrit | Sahada anında çözüm için `.nav` broadcast efemerisleri yeterlidir; istenirse milimetrik SP3 devreye girer. | Sadece SP3 zorunluluğu: Kullanıcı IGS ürünü yayınlanana kadar 12-24 saat beklemek zorunda kalırdı. |

---

## 4. Teknik Mimari & Veri Akışı

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       KULLANICI ARAYÜZÜ (REACT SPA)                         │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
│  │  Veri Girişi (RINEX)  │  │ Baz Çözücü Masası     │  │ 3D Dengeleme    │  │
│  │  .obs, .nav, .sp3     │  │ Canlı İlerleme & FIX  │  │ Gauss-Markov    │  │
│  └──────────┬────────────┘  └──────────▲────────────┘  └────────▲────────┘  │
└─────────────┼──────────────────────────┼────────────────────────┼───────────┘
              │                          │ PostMessage            │
              ▼                          │ State Update           │
┌────────────────────────────────────────┴────────────────────────┴───────────┐
│              WEB WORKER MOTORU: gnssBaselineWorker.ts                       │
│                                                                             │
│  1. RINEX GÖZLEM AYRIŞTIRICI & EPOK EŞLEŞTİRME                              │
│     • Base ve Rover epoklarının tamsayı zaman diliminde senkronizasyonu    │
│     • L1, L2 taşıyıcı fazları, C1, P2 pseudorange filtrelemesi             │
│                                                                             │
│  2. UYDU YÖRÜNGE HESAPLAYICI (ORBIT ENGINE)                                 │
│     • RINEX NAV Kepler efemerisleri: X(t), Y(t), Z(t) + Saat Düzeltmesi    │
│     • Sinyal seyahat süresi (τ) ve Dünya dönme düzeltmesi (Sagnac etkisi)  │
│                                                                             │
│  3. ÇİFT FARK (DOUBLE DIFFERENCE) MATRİS ÇEKİRDEĞİ                          │
│     • Pivot uydu seçimi (Zenit'e en yakın, en yüksek elevasyon açılı)      │
│     • Tek fark (Receiver clock yok etme) + Çift fark (Sat clock yok etme)  │
│     • Tasarım matrisi B ve Ağırlık matrisi P_DD kurulumu                   │
│                                                                             │
│  4. LAMBDA TAMSAYI FAZ BELİRSİZLİĞİ & RATIO TESTİ                           │
│     • Z-dönüşümü ile kovaryans dekorrelasyonu                              │
│     • Tamsayı arama (Integer Ambiguity Search: N1, N2)                     │
│     • Ratio Test: R = Ω2 / Ω1 >= 3.00 => FIX Çözüm                         │
│                                                                             │
│  5. ÇÖZÜLMÜŞ BAZ VEKTÖRÜ & 3x3 KOVARYANS ÇIKTISI                            │
│     • ΔX, ΔY, ΔZ ve Qxx, Qyy, Qzz, Qxy, Qyz, Qzx varyans-kovaryansları     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Uygulama Bileşenleri & Dosya Haritası
1. `src/workers/gnssBaselineWorker.ts`:
   * Web Worker arka plan iş parçacığı.
   * RINEX gözlem epoklarının senkronizasyonu, Kepler yörünge hesabı, DD tasarımı ve LAMBDA algoritması.
2. `src/utils/rinexNavParser.ts`:
   * RINEX v2/v3 GPS ve GLONASS navigasyon efemerislerini (`.nav`, `.n`, `.g`) ayrıştıran, uydu ECEF koordinatlarını milimetrik hesaplayan modül.
3. `src/utils/lambdaSolver.ts`:
   * LAMBDA (Least-squares AMBiguity Decorrelation Adjustment) çekirdeği: Z-dönüşümü, LDL ayrışımı, elipsoit arama ve Ratio testi.
4. `src/components/BaselinesTab.tsx`:
   * "Tek Tıkla Tüm Ağı Çöz ve Dengele" kontrolü, canlı Worker ilerleme göstergesi ve çözülen vektörlerin Topcon Tools standartlarında doğrulanması.
5. `src/utils/geodesy.ts`:
   * Gerçek faz baz vektörlerinin 3D Gauss-Markov dengelemesine pürüzsüz aktarımı.

---

## 5. Doğrulama & Kabul Kriterleri

1. **Topcon Tools Birebir Doğrulaması:**
   * Test verinizdeki `BAN1`, `BILE`, `BRS1`, `HARC` referansları ve `N.1002` (3552329) gezicisi kendi yerli motorumuz ile çözüldüğünde;
     * Topcon Tools $4497678.066\text{ m}$ (Northing) ve $455876.517\text{ m}$ (Easting) değerlerine **santimetre altı (milimetrik)** hassasiyetle ulaşmalıdır.
     * 2.07 metrelik navigasyon kayması **tamamen ortadan kalkmalıdır**.
2. **Performans Kriteri:**
   * 4 sabit ve 1 gezici arasındaki 4 baz vektörü, tarayıcıda Web Worker üzerinden **5 saniyenin altında** çözülmelidir.
3. **Derleme & Hata Denetimi:**
   * `lint_applet` ve `compile_applet` sıfır hata ile tamamlanmalıdır.
