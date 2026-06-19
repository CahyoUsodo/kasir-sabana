# Android Capacitor Build Notes

## Audit ringkas

- `package.json`: React + TypeScript + Vite, Dexie, html2canvas, vite-plugin-pwa, Capacitor ditambahkan sebagai target Android.
- `vite.config.ts`: PWA/Workbox tetap aktif untuk web, tetapi dimatikan untuk `vite build --mode android`.
- `src/components/Receipt.tsx`: UI receipt tetap ada, transport printer dipindah ke service.
- `src/lib/receipt-printer.ts`: builder ESC/POS lintas platform, web memakai Web Bluetooth, Android memakai plugin native `BluetoothPrinter`.
- `src/lib/db.ts`: Dexie + IndexedDB tetap dipertahankan.
- `src/lib/backup.ts`: backup/restore memakai endpoint Vercel langsung saat hostname lokal/Capacitor, sehingga cocok untuk WebView Android.
- Browser/device API yang ditemukan: `navigator.bluetooth`, `navigator.share`, `html2canvas`, PWA service worker, `localStorage`, `window.location`, Dexie/IndexedDB.

## Keputusan Android

- Web/PWA tetap menjadi target utama web.
- Android Capacitor adalah target tambahan.
- Build Android tidak mengaktifkan service worker untuk menghindari cache lama di WebView kasir.
- Printer Android tidak memakai Web Bluetooth. Jalur Android mengirim raw ESC/POS ke plugin native lokal melalui Bluetooth Classic SPP.
- Printer harus dipairing lebih dulu dari Android Settings. Plugin memilih device paired dengan nama berisi `printer`, `thermal`, `pos`, `rpp`, atau `mtp`; jika tidak ada, fallback ke paired device pertama.

## Build debug APK

1. Pastikan JDK 21 tersedia dan `JAVA_HOME` mengarah ke folder JDK.
2. Jalankan:

```powershell
npm run android:sync
npm run android:debug
```

APK debug ada di:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Alternatif buka Android Studio:

```powershell
npm run android:open
```

Lalu pilih `Build > Build Bundle(s) / APK(s) > Build APK(s)`.

## Build release

1. Buat konfigurasi signing release di Android Studio atau `android/app/build.gradle`.
2. Jalankan:

```powershell
npm run android:sync
npm run android:release
```

APK release unsigned/default Gradle ada di:

```text
android/app/build/outputs/apk/release/
```

Untuk distribusi produksi, gunakan signing key resmi dan pertimbangkan AAB via Android Studio.

## Checklist testing device nyata

- Install APK di tablet kasir Android.
- Buka aplikasi, onboarding/login, lalu pastikan data Dexie tetap tersimpan setelah app ditutup dan dibuka lagi.
- Buat transaksi baru dari halaman kasir.
- Cetak struk pelanggan dan struk dapur ke printer yang sudah dipairing.
- Matikan printer lalu coba cetak, pastikan error terbaca dan app tidak crash.
- Test logo struk bila toko memakai logo.
- Test share/download struk dari receipt.
- Test backup cloud manual dan restore dari Google Drive File ID.
- Test mode offline untuk transaksi lokal, lalu online lagi untuk backup.
- Tutup app saat halaman kasir terbuka, buka lagi, pastikan lifecycle tidak merusak draft/data.

## Risiko tersisa

- Plugin native saat ini mendukung printer Bluetooth Classic SPP. Printer BLE-only masih perlu plugin/implementasi khusus BLE.
- Pemilihan printer masih otomatis dari paired devices; untuk banyak printer di satu tablet sebaiknya tambah UI pemilihan dan simpan address.
- Build Gradle lokal membutuhkan JDK 21 dan Android SDK command-line tools.
- Perlu uji cetak fisik karena karakteristik buffer tiap printer thermal bisa berbeda.
