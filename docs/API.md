# TALLERO AUTO — SPESIFIKASI REFERENSI LENGKAP API (API.md)

Panduan referensi teknis integrasi terlengkap untuk tim **Frontend Web (React/Next.js)** dan **Mobile Apps (Expo/React Native)**. Dokumen ini menjadi rujukan tunggal kontrak endpoint yang dikelompokkan berdasarkan modul fitur operasional bengkel **Tallero Auto**.

---

## DAFTAR MODUL FITUR
1. [Standar Komunikasi & Konvensi Global](#1-standar-komunikasi--konvensi-global)
2. [Autentikasi & Profil Akun (`/auth`)](#2-autentikasi--profil-akun-auth)
3. [Akses Berkas Privat Bertanda Tangan (`/files`)](#3-akses-berkas-privat-bertanda-tangan-files)
4. [Ketersediaan Slot Cabang (`/outlets/:id/availability`)](#4-ketersediaan-slot-cabang-outletsidavailability)
5. [Outlet Cabang Bengkel (`/outlets` & `/admin/outlets`)](#5-outlet-cabang-bengkel-outlets--adminoutlets)
6. [Katalog Layanan & Kategori (`/categories`, `/services`, `/admin/*`)](#6-katalog-layanan--kategori-categories-services-admin)
7. [Katalog & Inventaris Suku Cadang (`/spareparts` & `/admin/spareparts`)](#7-katalog--inventaris-suku-cadang-spareparts--adminspareparts)
8. [Manajemen Kendaraan Pelanggan (`/vehicles`)](#8-manajemen-kendaraan-pelanggan-vehicles)
9. [Booking, Reservasi, & Alur Bengkel (`/bookings`)](#9-booking-reservasi--alur-bengkel-bookings)
10. [Pembayaran Midtrans, Tunai Kasir, Tip, & Faktur (`/payments` & `/bookings/:id/payments/*`)](#10-pembayaran-midtrans-tunai-kasir-tip--faktur-payments--bookingsidpayments)
11. [Ulasan & Rating Kepuasan (`/reviews` & `/bookings/:id/review`)](#11-ulasan--rating-kepuasan-reviews--bookingsidreview)
12. [Notifikasi & Token Notifikasi Perangkat (`/notifications`)](#12-notifikasi--token-notifikasi-perangkat-notifications)
13. [Asisten Bengkel Interaktif (`/assistant`)](#13-asisten-bengkel-interaktif-assistant)
14. [Operasional Staf & Antrean Pit (`/staff`)](#14-operasional-staf--antrean-pit-staff)
15. [Kelola Pengguna & Staf Admin (`/admin/users`)](#15-kelola-pengguna--staf-admin-adminusers)
16. [Dashboard, Laporan Operasional, & Audit Log (`/admin/dashboard`, `/admin/reports`, `/admin/audit-logs`)](#16-dashboard-laporan-operasional--audit-log-admindashboard-adminreports-adminaudit-logs)
17. [Pemeriksaan Kesehatan Server (`/health`, `/ready`)](#17-pemeriksaan-kesehatan-server-health-ready)

---

## 1. Standar Komunikasi & Konvensi Global

- **Base URL Prefix**: `/api/v1`
- **Envelope Respons Sukses (HTTP 200 / 201)**:
  ```json
  {
    "success": true,
    "data": { ... },
    "meta": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
  }
  ```
  *(Field `meta` hanya hadir pada respons data berupa daftar terpaginasi).*
- **Envelope Respons Gagal (HTTP 4xx / 5xx)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "BOOKING_NOT_FOUND",
      "message": "Data booking tidak ditemukan atau bukan milik Anda",
      "details": null
    }
  }
  ```
- **Prinsip Pertahanan IDOR (Insecure Direct Object Reference)**:
  Resource milik pengguna lain atau yang tidak ada selalu menghasilkan **HTTP 404 NOT_FOUND** (bukan 403) agar tidak membocorkan eksistensi data rahasia.
- **Konvensi Nilai Finansial & Waktu**:
  - **Uang**: Selalu integer Rupiah (`Int`, mis. `550000`), tidak ada float/desimal.
  - **Waktu**: Timestamp selalu disimpan dan ditransmisikan dalam format **ISO-8601 UTC** (`2026-11-20T09:00:00.000Z`). Konversi ke waktu lokal cabang (`Asia/Jakarta`) dilakukan di sisi presentasi klien.

---

## 2. Autentikasi & Profil Akun (`/auth`)

### 2.1. `POST /api/v1/auth/register`
- **Tujuan**: Mendaftarkan akun pelanggan (`CUSTOMER`) baru dan mengirimkan OTP verifikasi 6 digit ke email.
- **Role**: `ANON` (Publik)
- **Request Body**:
  | Field | Tipe | Wajib | Batasan / Validasi |
  |:---|:---|:---|:---|
  | `name` | string | Wajib | 2 - 100 karakter, trim |
  | `email` | string | Wajib | Format email valid, lowercase otomatis |
  | `phone` | string | Wajib | Regex Indonesia `^\+628[1-9][0-9]{7,11}$` |
  | `password` | string | Wajib | Minimal 8 karakter, ada kombinasi huruf dan angka |
  ```json
  {
    "name": "Budi Santoso",
    "email": "budi.santoso@gmail.com",
    "phone": "+6281234567890",
    "password": "PasswordKuat123"
  }
  ```
- **Respons Sukses (201 Created)**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Registrasi berhasil. Kode OTP verifikasi telah dikirimkan ke email Anda.",
      "email": "budi.santoso@gmail.com"
    }
  }
  ```
- **Daftar Error**:
  - `VALIDATION_ERROR` (400): Format input tidak valid. Tampilkan pesan kesalahan di bawah input form yang bersangkutan.
  - `EMAIL_ALREADY_REGISTERED` (400): Email sudah terdaftar dan terverifikasi. Arahkan pengguna ke halaman Login.
  - `RATE_LIMIT_EXCEEDED` (429): Terlalu banyak percobaan pendaftaran dari IP yang sama.
  - `EMAIL_DELIVERY_FAILED` (502): Kegagalan layanan SMTP email pengirim OTP. Tampilkan instruksi "Coba beberapa saat lagi".
- **Catatan Khusus**: Endpoint ini memiliki proteksi anti user-enumeration. Bila akun belum diverifikasi, server otomatis memperbarui kode OTP dan mengirimkannya ulang.

---

### 2.2. `POST /api/v1/auth/verify-otp`
- **Tujuan**: Memverifikasi kode OTP 6-digit pendaftaran pelanggan dan langsung menerbitkan sesi token.
- **Role**: `ANON`
- **Request Body**:
  | Field | Tipe | Wajib | Batasan / Validasi |
  |:---|:---|:---|:---|
  | `email` | string | Wajib | Format email valid |
  | `otp` | string | Wajib | Tepat 6 digit angka numerik |
  ```json
  {
    "email": "budi.santoso@gmail.com",
    "otp": "491823"
  }
  ```
- **Respons Sukses (200 OK)**:
  *(Untuk Web dengan header `X-Client: web`, cookie `refreshToken` terpasang di header `Set-Cookie`).*
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
      "tokenType": "Bearer",
      "expiresIn": 900,
      "refreshToken": "4a8f9b0c1e2d3f4a...",
      "user": {
        "id": 12,
        "name": "Budi Santoso",
        "email": "budi.santoso@gmail.com",
        "role": "CUSTOMER",
        "isVerified": true
      }
    }
  }
  ```
- **Daftar Error**:
  - `INVALID_OTP` (400): Kode OTP salah atau sudah kedaluwarsa. Tampilkan "Kode OTP salah".
  - `MAX_OTP_ATTEMPTS_EXCEEDED` (400): Kode OTP salah lebih dari 5 kali berturut-turut. Kode hangus; minta pengguna meminta OTP baru.

---

### 2.3. `POST /api/v1/auth/resend-otp`
- **Tujuan**: Mengirimkan ulang kode OTP baru ke email pelanggan pendaftar.
- **Role**: `ANON`
- **Request Body**:
  ```json
  {
    "email": "budi.santoso@gmail.com"
  }
  ```
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Kode OTP baru telah dikirimkan ke email Anda."
    }
  }
  ```
- **Daftar Error**:
  - `OTP_COOLDOWN_ACTIVE` (429): Belum mencapai batas cooldown 60 detik. Tampilkan countdown timer di tombol kirim ulang.
  - `OTP_MAX_SENDS_EXCEEDED` (429): Melebihi batas maksimal 5 kali kirim OTP dalam 1 jam.

---

### 2.4. `POST /api/v1/auth/login`
- **Tujuan**: Autentikasi pengguna (Admin, Mekanik, Pelanggan) dan menerbitkan sesi token.
- **Role**: `ANON`
- **Header Khusus Klien Web**: `X-Client: web`
- **Request Body**:
  ```json
  {
    "email": "admin@tallero.id",
    "password": "Password123"
  }
  ```
- **Respons Sukses (200 OK)**:
  *(Untuk Klien Web, refreshToken otomatis disimpan di HTTP-only cookie).*
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5c...",
      "tokenType": "Bearer",
      "expiresIn": 900,
      "refreshToken": "9d8e7f6a5b4c3d2e1f...",
      "user": {
        "id": 1,
        "name": "Budi Administrator",
        "email": "admin@tallero.id",
        "role": "ADMIN",
        "outletId": null,
        "mustChangePassword": false
      }
    }
  }
  ```
- **Daftar Error**:
  - `INVALID_CREDENTIALS` (401): Email atau password salah. Menggunakan hash dummy untuk mencegah serangan timing enumeration.
  - `ACCOUNT_LOCKED` (429): Akun terkunci sementara selama 15 menit akibat 5 kali gagal login berturut-turut.
  - `ACCOUNT_DEACTIVATED` (403): Akun telah dinonaktifkan oleh administrator.
- **Catatan Khusus**: Jika `mustChangePassword === true`, aplikasi wajib mengarahkan pengguna ke layar ganti password sebelum mengakses menu dashboard lainnya.

---

### 2.5. `POST /api/v1/auth/refresh`
- **Tujuan**: Rotasi sesi dan penerbitan Access Token baru (15 menit).
- **Role**: `ANON`
- **Request Body**:
  - Klien Web (`X-Client: web`): Tanpa body, server membaca `req.cookies.refreshToken`.
  - Klien Mobile: `{ "refreshToken": "<string_token_opaque>" }`
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
      "tokenType": "Bearer",
      "expiresIn": 900,
      "refreshToken": "new_opaque_token_here..."
    }
  }
  ```
- **Daftar Error**:
  - `UNAUTHORIZED` (401): Refresh token kedaluwarsa atau tidak valid. Hapus sesi lokal dan arahkan pengguna ke login.
  - `TOKEN_REUSED` (401): Terdeteksi upaya penggunaan ulang token lama yang sudah dirotasi (indikasi pencurian token). Seluruh sesi akun dicabut seketika.

---

### 2.6. `POST /api/v1/auth/logout` & `POST /api/v1/auth/logout-all`
- **Tujuan**:
  - `logout`: Mencabut refresh token yang sedang aktif.
  - `logout-all`: Mencabut seluruh sesi akun di seluruh perangkat dan meningkatkan `tokenVersion`.
- **Role**: `AUTH`
- **Header**: `Authorization: Bearer <accessToken>`
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": { "message": "Berhasil logout dan sesi telah dicabut." }
  }
  ```

---

### 2.7. `POST /api/v1/auth/forgot-password` & `POST /api/v1/auth/reset-password`
- **Tujuan**:
  - `forgot-password`: Mengirimkan tautan reset password 32-byte acak dengan TTL 30 menit ke email.
  - `reset-password`: Mengeksekusi perubahan password baru menggunakan token dari tautan email.
- **Role**: `ANON`
- **Request Body reset-password**:
  ```json
  {
    "token": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "password": "PasswordBaruKuat123"
  }
  ```
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": { "message": "Password berhasil diperbarui. Silakan login kembali." }
  }
  ```

---

### 2.8. `POST /api/v1/auth/change-password`
- **Tujuan**: Mengganti password akun saat sedang login (wajib bagi staf baru saat pertama kali masuk).
- **Role**: `AUTH`
- **Request Body**:
  ```json
  {
    "currentPassword": "PasswordLama123",
    "newPassword": "PasswordBaru456"
  }
  ```
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": { "message": "Password berhasil diganti. Silakan login kembali dengan password baru." }
  }
  ```

---

### 2.9. `GET /api/v1/auth/me` & `PATCH /api/v1/auth/me`
- **Tujuan**: Mengambil data profil dan memperbarui nama, nomor telepon, atau alamat pengguna.
- **Role**: `AUTH`
- **Request Body PATCH**:
  ```json
  {
    "name": "Budi Santoso Nugroho",
    "phone": "+6281299887766",
    "address": "Jl. Melati No. 45, Jakarta Selatan"
  }
  ```
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "id": 12,
      "name": "Budi Santoso Nugroho",
      "email": "budi.santoso@gmail.com",
      "phone": "+6281299887766",
      "address": "Jl. Melati No. 45, Jakarta Selatan",
      "avatarUrl": "http://localhost:5000/api/v1/files/avatar/12?exp=1763630600&sig=abcdef...",
      "role": "CUSTOMER"
    }
  }
  ```

---

### 2.10. `POST /api/v1/auth/me/avatar`
- **Tujuan**: Mengunggah foto profil pengguna.
- **Role**: `AUTH`
- **Content-Type**: `multipart/form-data` (Field: `file`)
- **Batasan**: Format JPEG/PNG/WebP, maksimal 5 MB. Server otomatis melakukan re-encode ke format WebP 1920px dan menghapus metadata EXIF/GPS.

---

## 3. Akses Berkas Privat Bertanda Tangan (`/files`)

### 3.1. `GET /api/v1/files/:kind/:id`
- **Tujuan**: Mengalirkan (*stream*) berkas foto privat (inspeksi pengerjaan atau avatar) menggunakan signed URL.
- **Role**: `ANON` / `AUTH` (Diotentikasi oleh parameter URL `sig` dan `exp`).
- **Query Params**:
  - `exp`: Timestamp Unix kedaluwarsa URL.
  - `sig`: Tanda tangan HMAC-SHA256 berumur 10 menit (`SIGNED_URL_TTL_SEC=600`).
- **Daftar Error**:
  - `INVALID_SIGNATURE` (401): Tanda tangan URL salah atau parameter dimanipulasi.
  - `SIGNATURE_EXPIRED` (401): URL sudah kedaluwarsa. Panggil kembali endpoint data utama untuk mendapatkan URL baru.
  - `FILE_NOT_FOUND` (404): Berkas fisik tidak ada di disk.

---

## 4. Ketersediaan Slot Cabang (`/outlets/:id/availability`)

### 4.1. `GET /api/v1/outlets/:id/availability`
- **Tujuan**: Mengambil daftar grid slot waktu reservasi pada tanggal tertentu untuk cabang bengkel.
- **Role**: `ANON` (Publik)
- **Path Params**: `:id` (ID Outlet)
- **Query Params**:
  - `date`: Format `YYYY-MM-DD` (Wajib, rentang hari ini s/d 30 hari ke depan).
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "outletId": 1,
      "date": "2026-11-20",
      "timezone": "Asia/Jakarta",
      "isClosed": false,
      "closureReason": null,
      "slots": [
        {
          "time": "08:00",
          "slotStart": "2026-11-20T01:00:00.000Z",
          "slotEnd": "2026-11-20T02:00:00.000Z",
          "capacity": 5,
          "booked": 4,
          "remaining": 1,
          "status": "LIMITED"
        },
        {
          "time": "09:00",
          "slotStart": "2026-11-20T02:00:00.000Z",
          "slotEnd": "2026-11-20T03:00:00.000Z",
          "capacity": 5,
          "booked": 5,
          "remaining": 0,
          "status": "FULL"
        }
      ]
    }
  }
  ```
- **Katalog Status Slot untuk UI**:
  - `AVAILABLE`: Slot terbuka dan memiliki sisa kapasitas $\ge 2$.
  - `LIMITED`: Slot hampir penuh (tersisa tepat 1 mobil). Beri badge peringatan oranye di UI.
  - `FULL`: Kapasitas slot telah terisi penuh. Tombol dinonaktifkan di UI.
  - `CLOSED`: Cabang tutup (di luar hari buka atau libur khusus).
  - `PAST`: Jam slot telah lewat atau kurang dari jarak minimum 60 menit (`MIN_LEAD_MINUTES`).

---

## 5. Outlet Cabang Bengkel (`/outlets` & `/admin/outlets`)

### 5.1. `GET /api/v1/outlets` & `GET /api/v1/outlets/:id`
- **Tujuan**: Mengambil daftar cabang aktif untuk dipilih pelanggan saat reservasi.
- **Role**: `ANON` (Publik)
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 1,
        "name": "Cabang Utama Margonda",
        "address": "Jl. Margonda Raya No. 120, Beji, Depok",
        "phone": "+622177889900",
        "latitude": -6.3686,
        "longitude": 106.8332,
        "openDays": [1, 2, 3, 4, 5, 6],
        "openTime": "08:00",
        "closeTime": "17:00",
        "slotCapacity": 5,
        "timezone": "Asia/Jakarta"
      }
    ]
  }
  ```

### 5.2. Admin Outlet Cabang: CRUD, Restore, & Libur Khusus
- `GET /api/v1/admin/outlets`: Ambil seluruh outlet (termasuk nonaktif).
- `POST /api/v1/admin/outlets`: Tambah cabang baru (`ADMIN`).
- `PATCH /api/v1/admin/outlets/:id`: Perbarui konfigurasi operasional cabang.
- `DELETE /api/v1/admin/outlets/:id`: Hapus soft-delete cabang (Ditolak jika ada booking aktif).
- `POST /api/v1/admin/outlets/:id/restore`: Pulihkan cabang terhapus.
- `POST /api/v1/admin/outlets/:id/closures`: Tambah jadwal tutup cabang (`date: "YYYY-MM-DD"`, `reason: "Renovasi Pit 3"`).
- `DELETE /api/v1/admin/outlets/:id/closures/:closureId`: Hapus jadwal tutup cabang.

---

## 6. Katalog Layanan & Kategori (`/categories`, `/services`, `/admin/*`)

### 6.1. `GET /api/v1/categories` & `GET /api/v1/services`
- **Tujuan**: Katalog publik paket servis untuk halaman Landing Page dan Keranjang Reservasi.
- **Role**: `ANON` (Publik)
- **Respons Sukses `GET /services` (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 1,
        "name": "Tune Up & Cleaning Injektor",
        "description": "Paket pembersihan ruang bakar mesin bensin & kalibrasi ECU",
        "price": 350000,
        "estimatedMinutes": 60,
        "vehicleType": "CAR",
        "category": { "id": 1, "name": "Perawatan Berkala" }
      }
    ]
  }
  ```

### 6.2. Admin CRUD Katalog Servis & Kategori
- `POST /api/v1/admin/categories` & `PATCH /api/v1/admin/categories/:id`
- `DELETE /api/v1/admin/categories/:id` & `POST /api/v1/admin/categories/:id/restore`
- `POST /api/v1/admin/services` & `PATCH /api/v1/admin/services/:id`
- `DELETE /api/v1/admin/services/:id` & `POST /api/v1/admin/services/:id/restore`

---

## 7. Katalog & Inventaris Suku Cadang (`/spareparts` & `/admin/spareparts`)

### 7.1. `GET /api/v1/spareparts`
- **Tujuan**: Katalog suku cadang aktif (SKU, nama, harga eceran bengkel).
- **Role**: `ANON` (Publik)

### 7.2. Admin Kelola Suku Cadang & Stok Fisik
- `GET /api/v1/admin/spareparts`: Daftar suku cadang beserta jumlah stok fisik gudang.
- `POST /api/v1/admin/spareparts`: Tambah suku cadang baru (`sku`, `name`, `price`, `stock`, `unit`).
- `PATCH /api/v1/admin/spareparts/:id`: Edit suku cadang.
- `DELETE /api/v1/admin/spareparts/:id` & `POST /api/v1/admin/spareparts/:id/restore`: Soft delete & restore.
- `POST /api/v1/admin/spareparts/:id/adjust-stock`: Penyesuaian stok opname manual:
  ```json
  {
    "newStock": 15,
    "reason": "Stock opname fisik akhir bulan"
  }
  ```

---

## 8. Manajemen Kendaraan Pelanggan (`/vehicles`)

### 8.1. CRUD Kendaraan (`GET`, `POST`, `PATCH`, `DELETE /api/v1/vehicles/:id`)
- **Role**: `CUSTOMER`
- **Aturan Validasi Plat Nomor**:
  - Format regex: `^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$` (contoh: `B1234XYZ`).
  - Disimpan dalam format huruf kapital tanpa spasi.
- **Request Body POST**:
  ```json
  {
    "plateNumber": "B1234XYZ",
    "brand": "Toyota",
    "model": "Avanza Veloz 1.5 AT",
    "type": "CAR",
    "year": 2022,
    "color": "Putih Mutiara",
    "lastOdometerKm": 42000
  }
  ```

### 8.2. `GET /api/v1/vehicles/:id/history` & `GET /api/v1/vehicles/:id/reminders`
- **Tujuan**:
  - `history`: Riwayat pengerjaan servis masa lalu yang sudah `COMPLETED` untuk mobil tersebut.
  - `reminders`: Jadwal pengingat servis jatuh tempo berdasarkan tanggal atau pembacaan odometer.
- **Role**: `CUSTOMER` (Pemilik mobil) atau `STAFF` (Mekanik/Admin).

---

## 9. Booking, Reservasi, & Alur Bengkel (`/bookings`)

### 9.1. `POST /api/v1/bookings`
- **Tujuan**: Pelanggan membuat reservasi booking servis baru.
- **Role**: `CUSTOMER`
- **Request Body**:
  ```json
  {
    "outletId": 1,
    "vehicleId": 4,
    "scheduledAt": "2026-11-20T09:00:00+07:00",
    "customerNotes": "Getaran halus pada pedal rem",
    "items": [
      { "type": "SERVICE", "serviceId": 1, "quantity": 1 }
    ]
  }
  ```
- **Respons Sukses (201 Created)**:
  ```json
  {
    "success": true,
    "data": {
      "id": 101,
      "code": "TLR-20261120-X8J2K1",
      "status": "PENDING",
      "total": 350000,
      "scheduledAt": "2026-11-20T02:00:00.000Z"
    }
  }
  ```
- **Daftar Error**:
  - `SLOT_FULL` (409): Kapasitas slot jam tersebut telah penuh.
  - `MAX_ACTIVE_BOOKINGS_EXCEEDED` (422): Pelanggan sudah memiliki 3 booking aktif yang belum selesai.
  - `VEHICLE_HAS_ACTIVE_BOOKING` (422): Kendaraan tersebut sedang memiliki booking yang sedang berjalan.

---

### 9.2. `GET /api/v1/bookings/:id/qr` & `POST /api/v1/bookings/check-in`
- **Tujuan**:
  - `GET /qr`: Pelanggan mengambil payload QR Code untuk check-in di gerbang bengkel.
  - `POST /check-in`: Staf memindai QR code pelanggan dan mencatat kilometer odometer fisik mobil.
- **Role**:
  - `GET /qr`: `CUSTOMER` (Pemilik)
  - `POST /check-in`: `STAFF`
- **Request Body Check-in**:
  ```json
  {
    "qrPayload": "TLR-20261120-X8J2K1.1763630000.a1b2c3d4e5f67890",
    "odometerKm": 42150
  }
  ```
- **Transisi Status**: `PENDING` $\rightarrow$ `CHECKED_IN` (Menerbitkan `queueNumber` harian).

---

### 9.3. `POST /api/v1/bookings/:id/start`
- **Tujuan**: Memulai pengerjaan unit oleh mekanik yang bertugas.
- **Role**: `STAFF`
- **Transisi Status**: `CHECKED_IN` $\rightarrow$ `IN_PROGRESS`
- **Aturan Guard**:
  - Booking harus merupakan unit terdepan antrean (*queue head*) untuk mekanik tersebut.
  - Mekanik belum memiliki pengerjaan aktif lain (`MAX_ACTIVE_JOBS_PER_MECHANIC=1`).
  - Stok suku cadang untuk item yang disetujui dipotong secara otomatis.

---

### 9.4. `POST /api/v1/bookings/:id/items` & `POST /api/v1/bookings/:id/approvals`
- **Tujuan**:
  - `POST /items`: Mekanik mengajukan rekomendasi perbaikan/suku cadang tambahan.
    Transisi: `IN_PROGRESS` $\rightarrow$ `WAITING_APPROVAL`.
  - `POST /approvals`: Pelanggan menyetujui atau menolak daftar item tambahan.
    Ketika seluruh item pending telah diputuskan, status kembali: `WAITING_APPROVAL` $\rightarrow$ `IN_PROGRESS`.
- **Request Body Approvals**:
  ```json
  {
    "decisions": [
      { "itemId": 204, "approved": true },
      { "itemId": 205, "approved": false, "rejectReason": "Biaya melebihi anggaran saat ini" }
    ]
  }
  ```

---

### 9.5. `POST /api/v1/bookings/:id/photos` & `DELETE /api/v1/bookings/:id/photos/:photoId`
- **Tujuan**: Mekanik mengunggah dokumentasi kondisi kendaraan sebelum (`BEFORE`) dan sesudah perbaikan (`AFTER`).
- **Role**: `STAFF`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `file`: Berkas gambar (Maksimal 5 MB).
  - `type`: Enum `BEFORE` atau `AFTER`.
  - `caption`: Catatan penjelasan opsional.

---

### 9.6. `POST /api/v1/bookings/:id/ready` & `POST /api/v1/bookings/:id/complete`
- **Tujuan**:
  - `POST /ready`: Menandai mobil telah selesai diservis dan siap diambil pelanggan.
    - Syarat: Minimal 1 foto `BEFORE` dan 1 foto `AFTER` telah diunggah, tidak ada item tertunda approval.
    - Transisi: `IN_PROGRESS` $\rightarrow$ `READY_FOR_PICKUP`.
  - `POST /complete`: Menutup transaksi bengkel oleh Admin kasir.
    - Syarat: Status pembayaran booking sudah `PAID`.
    - Transisi: `READY_FOR_PICKUP` $\rightarrow$ `COMPLETED` (Menerbitkan nomor faktur resmi & menjadwalkan reminder servis berkala).

---

## 10. Pembayaran Midtrans, Tunai Kasir, Tip, & Faktur

### 10.1. `POST /api/v1/bookings/:id/payments/midtrans`
- **Tujuan**: Menerbitkan token transaksi Midtrans Snap untuk pembayaran pelunasan tagihan online.
- **Role**: `CUSTOMER` / `ADMIN`
- **Syarat**: Booking berstatus `READY_FOR_PICKUP` dan `paymentStatus === "UNPAID"`.
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "orderId": "TLR-20261120-X8J2K1-INV-1",
      "grossAmount": 550000,
      "snapToken": "c1f7a290-b19e-4e3f-8468-b32876543210",
      "redirectUrl": "https://app.sandbox.midtrans.com/snap/v2/vtweb/c1f7a290..."
    }
  }
  ```

---

### 10.2. `POST /api/v1/bookings/:id/payments/cash`
- **Tujuan**: Kasir Admin mencatat pembayaran tagihan tunai secara langsung di meja kasir.
- **Role**: `ADMIN`
- **Aksi Server**: Mencatat transaksi, membatalkan transaksi Snap yang sedang pending di Midtrans, dan memperbarui `Booking.paymentStatus = "PAID"`.

---

### 10.3. `POST /api/v1/bookings/:id/tips`
- **Tujuan**: Pelanggan memberikan tip apresiasi kepada mekanik penangan via Midtrans Snap.
- **Role**: `CUSTOMER`
- **Batasan**: Nominal antara Rp 1.000 s/d Rp 500.000, maksimal dalam rentang 7 hari setelah servis selesai. Tip merupakan hak mekanik sepenuhnya dan dicatat terpisah dari pendapatan bengkel.

---

### 10.4. `GET /api/v1/bookings/:id/invoice.pdf`
- **Tujuan**: Mengunduh berkas faktur resmi bengkel dalam format PDF.
- **Role**: `AUTH` (Pemilik booking atau Staf).
- **Syarat**: Booking harus sudah berstatus lunas (`paymentStatus === "PAID"`).

---

## 11. Ulasan & Rating Kepuasan (`/reviews` & `/bookings/:id/review`)

### 11.1. `POST /api/v1/bookings/:id/review`
- **Tujuan**: Memberikan penilaian 1-5 bintang dan ulasan pengerjaan servis.
- **Role**: `CUSTOMER` (Pemilik mobil).
- **Syarat**: Status booking `COMPLETED`, batas maksimal 30 hari sejak selesai, 1 kali ulasan per booking.
- **Request Body**:
  ```json
  {
    "rating": 5,
    "comment": "Pengerjaan sangat rapi dan montir menjelaskan kondisi rem dengan transparan."
  }
  ```

### 11.2. `GET /api/v1/outlets/:id/reviews` & `PATCH /api/v1/admin/reviews/:id/visibility`
- `GET /outlets/:id/reviews`: Menampilkan ulasan publik pelanggan yang disamarkan namanya (hanya nama depan) dan hanya yang tidak disembunyikan (`isHidden === false`).
- `PATCH /admin/reviews/:id/visibility`: Admin memoderasi ulasan yang mengandung unsur spam atau ofensif (`{ "isHidden": true }`).

---

## 12. Notifikasi & Token Notifikasi Perangkat (`/notifications`)

- `GET /api/v1/notifications`: Mengambil daftar notifikasi pengguna login terpaginasi.
- `GET /api/v1/notifications/unread-count`: Mengambil jumlah notifikasi belum dibaca (untuk badge lonceng di UI).
- `PATCH /api/v1/notifications/:id/read`: Menandai 1 notifikasi telah dibaca.
- `POST /api/v1/notifications/read-all`: Menandai seluruh notifikasi telah dibaca.
- `POST /api/v1/notifications/devices`: Mendaftarkan Expo Push Token perangkat mobile:
  ```json
  {
    "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "platform": "ANDROID"
  }
  ```
- `DELETE /api/v1/notifications/devices`: Menghapus token perangkat saat pengguna logout.

---

## 13. Asisten Bengkel Interaktif (`/assistant`)

### 13.1. `GET /api/v1/assistant/menu` & `POST /api/v1/assistant/query`
- **Tujuan**: Asisten pintar yang membantu pelanggan menjadwalkan booking, cek status pengerjaan, dan konsultasi kendala umum otomotif.
- **Role**: `CUSTOMER`
- **Request Body Query**:
  ```json
  {
    "query": "Kapan jadwal servis oli berkala saya berikutnya?"
  }
  ```

---

## 14. Operasional Staf & Antrean Pit (`/staff`)

- `GET /api/v1/staff/queue`: Menampilkan urutan antrean mobil di cabang staf yang bersangkutan (menampilkan nomor antrean, nama depan pemilik, tipe mobil, dan mekanik yang ditugaskan).
- `POST /api/v1/staff/queue/claim-next`: Mekanik mengklaim dan memulai servis untuk unit terdepan antrean tanpa menunggu assign manual Admin.
- `GET /api/v1/staff/me/jobs`: Daftar seluruh pekerjaan servis yang pernah dikerjakan oleh mekanik yang sedang login.
- `GET /api/v1/staff/me/reviews`: Daftar ulasan pelanggan yang diterima oleh mekanik.
- `GET /api/v1/staff/me/tips`: Daftar dan total pendapatan tip yang diterima oleh mekanik.

---

## 15. Kelola Pengguna & Staf Admin (`/admin/users`)

- `GET /api/v1/admin/users`: Daftar pengguna, staf, dan mekanik bengkel (mendukung filter role dan pencarian nama/email).
- `POST /api/v1/admin/users`: Admin membuat akun staf baru (Mekanik cabang wajib memilih `outletId`). Akun otomatis memiliki `mustChangePassword = true`.
- `PATCH /api/v1/admin/users/:id/status`: Mengaktifkan/menonaktifkan akun. Menonaktifkan akun akan langsung menaikkan `tokenVersion` dan mencabut seluruh sesi token aktif pengguna tersebut.
- `DELETE /api/v1/admin/users/:id`: Soft delete akun pengguna (Admin tidak dapat menghapus dirinya sendiri atau admin aktif terakhir).
- `POST /api/v1/admin/users/:id/restore`: Memulihkan akun pengguna yang pernah dihapus.

---

## 16. Dashboard, Laporan Operasional, & Audit Log

### 16.1. `GET /api/v1/admin/dashboard`
- **Tujuan**: Statistik eksekutif operasional bengkel secara real-time.
- **Role**: `ADMIN`
- **Respons Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "todayBookingsCount": 14,
      "inProgressCount": 3,
      "revenue": {
        "today": 4250000,
        "thisMonth": 87500000,
        "previousMonthComparison": 12.5
      },
      "noShowRate": 4.2,
      "averageServiceDurationMinutes": 75,
      "lowStockPartsCount": 2,
      "activeMechanicsCount": 4
    }
  }
  ```

### 16.2. `GET /api/v1/admin/reports/summary` & `GET /api/v1/admin/reports/export`
- **Tujuan**:
  - `summary`: Data tabel dan analitik rentang tanggal (`from` s/d `to`, maksimal 366 hari).
  - `export`: Mengunduh berkas laporan dalam format `csv`, `xlsx`, atau `pdf`.
- **Query Params**:
  - `type`: `revenue` | `bookings` | `mechanics` | `services` | `stock`
  - `format`: `csv` | `xlsx` | `pdf`
  - `from`: `YYYY-MM-DD`
  - `to`: `YYYY-MM-DD`

---

## 17. Pemeriksaan Kesehatan Server (`/health`, `/ready`)

- `GET /api/v1/health`: Mengembalikan `{ "status": "ok", "uptime": 12450 }`. Digunakan oleh Docker/K8s liveness probe.
- `GET /api/v1/ready`: Memverifikasi kesiapan koneksi database PostgreSQL via Prisma `prisma.$queryRaw` SELECT 1.
