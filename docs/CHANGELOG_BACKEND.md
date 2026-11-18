# TALLERO AUTO — BACKEND CHANGELOG & KONTRAK VERSI (CHANGELOG_BACKEND.md)

Dokumen ini mencatat riwayat perubahan arsitektur, kelengkapan fitur per modul, batasan teknis (*known limitations*), dan versi kontrak API Backend **Tallero Auto**.

---

## [Versi 1.0.0] — 2026-11-18 (Baseline Kontrak Resmi)

Kontrak API baseline stabil pertama yang mencakup seluruh spesifikasi **AGENTS.md** dengan total **106 endpoint** aktif, teruji, dan terdokumentasi.

---

### 1. Rangkuman Fitur Selesai per Modul

#### A. Autentikasi & Keamanan Sesi (`/auth`)
- **Status**: **Lengkap**
- **Kemampuan**:
  - Registrasi pelanggan publik (`CUSTOMER`) dengan verifikasi OTP 6-digit via SMTP Gmail.
  - Sesi berbasis token ganda: Access Token (JWT 15 menit) dan Refresh Token opaque 48-byte ter-rotasi (30 hari).
  - Penyimpanan cookie HTTP-Only untuk Klien Web (`X-Client: web`) dan JSON body untuk Klien Mobile (`expo-secure-store`).
  - Deteksi penggunaan ulang refresh token (*Token Reuse Detection*): Pencabutan seketika seluruh family token akun jika terdeteksi token lama dipakai ulang.
  - Lockout akun otomatis selama 15 menit setelah 5 kali gagal login berturut-turut.
  - Pertahanan *timing enumeration* menggunakan `dummyCompare` bcrypt cost 12.
  - Alur lupa password menggunakan tautan email dengan token acak 32-byte (TTL 30 menit).
  - Penegakan `mustChangePassword` untuk staf baru yang didaftarkan oleh Admin.

#### B. Pengelolaan Berkas Privat Bertanda Tangan (`/files`)
- **Status**: **Lengkap**
- **Kemampuan**:
  - Seluruh berkas disimpan di luar jangkauan publik (`storage/private/`).
  - Upload avatar profil dan foto inspeksi pengerjaan via `multer` memori.
  - Validasi header berkas asli (*magic bytes*) via `file-type`.
  - Re-encoding gambar ke WebP 1920px dan penghapusan permanen metadata EXIF/GPS via `sharp`.
  - Akses berkas melalui Signed URL berumur pendek (10 menit) yang divalidasi via HMAC-SHA256 `timingSafeEqual`.

#### C. Ketersediaan Slot & Reservasi Cabang (`/outlets/:id/availability`)
- **Status**: **Lengkap**
- **Kemampuan**:
  - Pembangkitan grid slot per jam (`slotMinutes = 60`) dari `openTime` hingga `closeTime`.
  - Pengecekan hari libur mingguan dan jadwal tutup khusus (`OutletClosure`).
  - Status slot dinamis: `AVAILABLE`, `LIMITED` (sisa 1), `FULL`, `CLOSED`, dan `PAST`.
  - Pencegahan *overbooking* konkuren menggunakan transaksi atomik dengan row-locking outlet (`SELECT ... FOR UPDATE`).
  - Penegakan batas pemesanan minimal 60 menit ke depan dan maksimal 30 hari ke muka.

#### D. Master Data Outlet, Katalog Servis, & Suku Cadang
- **Status**: **Lengkap**
- **Kemampuan**:
  - CRUD master data cabang bengkel, kategori servis, paket layanan, dan suku cadang.
  - Penerapan *soft-delete* (`deletedAt`) yang transparan via Prisma Client Extension.
  - Pembatalan hapus (*restore*) untuk entitas master.
  - Penyesuaian stok opname manual suku cadang dengan catatan audit.
  - Penguncian hapus jika entitas masih terikat dengan booking aktif yang belum tuntas.

#### E. Manajemen Kendaraan Pelanggan (`/vehicles`)
- **Status**: **Lengkap**
- **Kemampuan**:
  - CRUD kendaraan pelanggan dengan validasi plat nomor regex Indonesia (`B1234XYZ`).
  - Pemantauan riwayat servis masa lalu kendaraan (`/history`).
  - Pemantauan jadwal pengingat servis berkala (`/reminders`).

#### F. Booking Servis & State Machine Pengerjaan (`/bookings`)
- **Status**: **Lengkap**
- **Kemampuan**:
  - Satu pintu perubahan status: `bookingStateMachine.service.js`.
  - Check-in di gerbang menggunakan QR Code bertanda tangan digital HMAC + pencatatan kilometer odometer fisik.
  - Alur antrean anti-menyelak: Mekanik hanya dapat mengklaim unit di kepala antrean (`queueNumber` terkecil).
  - Pembatasan beban kerja mekanik maksimal 1 unit aktif (`MAX_ACTIVE_JOBS = 1`).
  - Pengajuan rekomendasi suku cadang/jasa tambahan oleh mekanik (`WAITING_APPROVAL`).
  - Persetujuan/penolakan batch oleh pelanggan (atau Admin via telepon dengan audit log).
  - Upload foto bukti pengerjaan wajib (minimal 1 foto `BEFORE` dan 1 foto `AFTER`) sebelum mobil dapat dinyatakan siap diambil (`READY_FOR_PICKUP`).

#### G. Pembayaran Midtrans Snap, Kasir Tunai, & Tip (`/payments`)
- **Status**: **Lengkap**
- **Kemampuan**:
  - Pembayaran online otomatis melalui Midtrans Snap API (gross amount persis dihitung dari server).
  - Webhook Midtrans terverifikasi kriptografis SHA-512 dengan pengecekan ganda ke Midtrans Status API.
  - Pembayaran tunai langsung di meja kasir Admin yang membatalkan transaksi online pending secara otomatis.
  - Penanganan transaksi ganda susulan (*Duplicate Settlement*) yang ditandai untuk refund manual.
  - Uang tip apresiasi mekanik via Snap (maksimal Rp 500.000, rentang 7 hari, bukan pendapatan bengkel).
  - Pembuatan dan pengunduhan faktur resmi PDF ber-watermark lunas (`pdfkit`).

#### H. Ulasan, Notifikasi, Asisten Bengkel, & Realtime
- **Status**: **Lengkap**
- **Kemampuan**:
  - Ulasan pelanggan rating 1-5 bintang (maksimal 30 hari pasca servis, ulasan publik disamarkan nama depan).
  - Sistem notifikasi tersimpan di database dengan dukungan Expo Push Notification.
  - Asisten bengkel pintar untuk tanya jawab kendala umum dan jadwal servis.
  - Realtime Socket.IO terautentikasi dengan isolasi room per-user, room staf cabang, dan room admin (tanpa broadcast global).

#### I. Laporan Operasional & Audit Trail
- **Status**: **Lengkap**
- **Kemampuan**:
  - Dashboard statistik eksekutif (omzet, distribusi booking, durasi servis, stok menipis).
  - Laporan operasional dengan pengelompokan tanggal di level SQL zona waktu `Asia/Jakarta`.
  - Ekspor laporan dalam format CSV, XLSX (Excel), dan PDF dengan sanitasi formula injection.
  - Jejak audit rekam perubahan data sensitif (`AuditLog`).

---

### 2. Batasan Teknis yang Ditetapkan (Known Constraints)

1. **Tanpa Docker**: Backend dirancang untuk dijalankan langsung di Node.js LTS dengan database PostgreSQL lokal di mesin dev.
2. **Keterikatan Mekanik**: Setiap akun dengan role `MECHANIC` wajib terikat pada satu cabang (`outletId`). Mekanik tidak dapat menangani mobil di luar cabang penugasannya.
3. **Format Angka Rupiah**: Seluruh nilai transaksi adalah bilangan bulat positif (`Int`). Backend tidak menerima atau mengembalikan angka desimal / float.
4. **Alur Refresh Single-Flight**: Klien wajib mengantrekan request saat access token kedaluwarsa agar tidak memicu pemanggilan refresh ganda yang menyebabkan pembatalan sesi (*token reuse false alarm*).

