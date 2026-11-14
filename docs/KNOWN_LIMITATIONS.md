# TALLERO AUTO — KNOWN LIMITATIONS & RISK REGISTER

Dokumen ini mendokumentasikan secara jujur, transparan, dan terukur seluruh keterbatasan desain sistem, batasan fungsional saat ini, serta mitigasi risiko yang ada pada backend **Tallero Auto**.

---

## 1. Pembayaran & Pengembalian Dana (Refund Midtrans)

- **Batasan**:
  Saat ini, inisiasi pengembalian dana (*refund*) transaksi pembayaran online Midtrans dilakukan secara manual oleh tim Finance / Admin melalui dashboard resmi **Midtrans Merchant Administration Portal (MAP)**.
- **Perilaku Sistem**:
  Backend mendukung penanganan status refund secara reaktif dan otomatis melalui Webhook Notification Midtrans (`POST /api/v1/payments/midtrans/notification`). Ketika Midtrans mengirimkan notifikasi event `refund` atau `partial_refund`, backend memvalidasi signature SHA-512, mengupdate status record pembayaran menjadi `REFUNDED`, mencatat `AuditLog`, serta secara otomatis mengurangi total *Net Revenue* pada laporan dashboard admin.
- **Rencana Mitigasi Mendatang**:
  Pengembangan endpoint `POST /admin/payments/:id/refund` yang memanggil langsung Midtrans Direct Refund API dengan mekanisme *Dual Approval* (Maker-Checker) sebelum dana dikembalikan ke rekening/e-wallet pelanggan.

---

## 2. Manajemen Stok Suku Cadang Terpusat (Global Inventory)

- **Batasan**:
  Model database `Sparepart` saat ini menerapkan kuantitas stok tunggal terpusat (*single global inventory*). Pemotongan stok saat servis dimulai (`POST /bookings/:id/start`) dan saat approval item tambahan berlaku secara global lintas seluruh cabang outlet.
- **Dampak Bisnis**:
  Bagi bengkel dengan gudang logistik terpusat atau outlet yang lokasinya berdekatan dengan transfer stok harian, pendekatan ini memadai. Namun, untuk cabang antarkota dengan gudang fisik terpisah, ketersediaan fisik di rak cabang tertentu belum terisolasi di database.
- **Rencana Mitigasi Mendatang**:
  Menambahkan model relasi `OutletSparepart` (`outletId`, `sparepartId`, `stock`, `minimumThreshold`) untuk mendukung multi-warehouse dan pencatatan mutasi transfer antar-cabang (*inter-branch stock transfer*).

---

## 3. Autentikasi & Verifikasi Dua Langkah (2FA)

- **Batasan**:
  Sistem keamanan akun saat ini mengandalkan:
  - Sandi kuat (`bcrypt` cost 12, minimum 8 karakter huruf + angka).
  - OTP 6-digit via email terenkripsi HMAC-SHA256 untuk registrasi.
  - Reset password menggunakan link bertoken acak 32-byte kriptografis (TTL 30 menit).
  - Rotasi refresh token opaque dengan deteksi *reuse* (*family token revocation*).
  - *Belum* mendukung verifikasi dua langkah berbasis aplikasi (TOTP / Google Authenticator) atau SMS OTP.
- **Rencana Mitigasi Mendatang**:
  Mengintegrasikan RFC 6238 TOTP (`speakeasy` / `otplib`) untuk autentikasi dua faktor akun Admin dan Mekanik.

---

## 4. Penjadwalan Tugas Otomatis (In-Process Node-Cron)

- **Batasan**:
  Seluruh tugas berkala (cron harian no-show pukul 21:00 WIB, pembersihan token kedaluwarsa pukul 03:00 WIB, evaluasi reminder servis pukul 08:00 WIB, dan sinkronisasi pembayaran pending setiap 5 menit) dijalankan menggunakan modul `node-cron` in-process di dalam server Express tunggal.
- **Dampak Arsitektur**:
  Pada deployment skala horizontal dengan banyak instance (*multi-replica container*), penjadwal cron akan terpicu di setiap instance secara bersamaan jika tidak dipasang *distributed lock*.
- **Mitigasi Saat Ini**:
  Seluruh query pada job (seperti `noShow.job.js`, `cleanup.job.js`, `paymentSync.job.js`, dan `reminders.job.js`) dirancang bersifat **idempotent** dan menggunakan update bersyarat (`updateMany` dengan filter status).
- **Rencana Mitigasi Mendatang**:
  Memindahkan task runner ke sistem antrian terdistribusi seperti Redis BullMQ atau PostgreSQL advisory locks (`pg-boss`) sebelum menerapkan horizontal scaling multi-server.

---

## 5. Audit Ketergantungan Paket (npm audit Report)

- **Status Hasil Audit**:
  Eksekusi `npm audit` menunjukkan 7 catatan kerentanan pada dependensi sekunder (*transitive dependencies*):
  1. `@vitest/mocker` / `vitest` (DevDependency untuk testing).
  2. `tinypool` (DevDependency pendukung vitest).
  3. `minimatch` / `nodemon` (DevDependency untuk reload server lokal).
  4. `uuid` versi lama di dalam paket `exceljs`.
- **Justifikasi Teknis**:
  - Kerentanan pada `vitest`, `tinypool`, dan `nodemon` hanya aktif pada lingkungan pengembangan lokal (*dev environment*) dan tidak diekspos pada server production runtime.
  - Perbaikan otomatis melalui `npm audit fix --force` akan men-downgrade `exceljs` ke versi 3.x yang memicu *breaking change* pada modul ekspor spreadsheet XLSX.
  - Seluruh input ekspor XLSX pada `src/services/reportExporters.js` telah disanitasi secara murni (`sanitizeCell`) dari potensi formula injection, dan file hanya dibangkitkan dari data internal terotentikasi Admin.

