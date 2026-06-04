# 🧾 Kasir Sabana

Aplikasi kasir (Point of Sale / POS) untuk keperluan pribadi operasional cabang Sabana. Aplikasi ini berjalan sepenuhnya secara offline di perangkat, cepat, dan dilengkapi dengan fitur auto-backup otomatis ke Google Drive.

---

## ✨ Fitur Utama

- **Kasir Cepat & Responsif** — Antarmuka kasir yang dirancang khusus untuk HP (Mobile-first). Memiliki fitur keranjang, diskon per-item, diskon transaksi, dan kalkulasi kembalian otomatis.
- **Auto-Backup ke Google Drive** — Data transaksi dan stok secara otomatis dicadangkan ke Google Drive setiap hari di belakang layar melalui Vercel, tanpa perlu login akun Google di HP kasir.
- **Cetak Struk Kustom** — Mendukung cetak struk via Bluetooth Thermal Printer dengan penyesuaian logo Sabana dan posisi teks yang proporsional.
- **Manajemen Stok** — Pencatatan barang masuk (Stock In) dan barang keluar (Stock Out) dengan kalkulasi Harga Pokok Penjualan (HPP) otomatis menggunakan metode rata-rata tertimbang.
- **Manajemen Produk & Kategori** — Atur menu Sabana dengan mudah, lengkap beserta harga jual, modal, dan satuannya.
- **Laporan Penjualan** — Pantau grafik pendapatan, keuntungan, dan produk terlaris.
- **Multi-User (Opsional)** — Akses terpisah antara Pemilik dan Karyawan menggunakan PIN.
- **Mode Gelap (Dark Mode)** — Tampilan bisa diubah ke tema gelap.
- **PWA (Aplikasi Offline)** — Bisa di-install langsung ke *Home Screen* HP dan berjalan 100% tanpa internet (kecuali saat proses *auto-backup*).

---

## 🛠️ Teknologi yang Digunakan

Aplikasi ini dibangun menggunakan *stack* modern:

- **Frontend:** React 18, TypeScript, Vite
- **Styling:** Tailwind CSS, shadcn/ui
- **Database:** IndexedDB (via Dexie.js) untuk penyimpanan lokal
- **Backend / Cloud Backup:** Vercel Serverless Functions + Google Drive API
- **PWA:** vite-plugin-pwa (Workbox)
- **Komponen Pendukung:** Recharts, React Hook Form, Zod, Lucide React

---

## 🚀 Cara Menjalankan (Development)

Jika ingin memodifikasi atau menjalankan aplikasi ini di komputer:

1. **Clone repository ini**
   ```bash
   git clone https://github.com/CahyoUsodo/kasir-sabana.git
   cd kasir-sabana
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Jalankan server lokal**
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di `http://localhost:8080`.

