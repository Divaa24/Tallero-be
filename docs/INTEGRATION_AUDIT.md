> Verifikasi terbaru: [VERIFICATION_2026-11-18.md](VERIFICATION_2026-11-18.md). Kesimpulan pengujian lama di bawah ini bersifat historis.

# TALLERO AUTO — INTEGRATION AUDIT & GAP ANALYSIS (FASE I-0)

Dokumen ini merupakan hasil audit komprehensif monorepo **Tallero Auto** untuk memetakan keselarasan antara Frontend Web (Admin & Pelanggan), Backend API, dan rencana aplikasi Mobile sebelum proses integrasi sistem dijalankan.

---

## 1. Pemetaan Struktur Monorepo & Ekosistem Teknologi

### A. Struktur Folder & Workspaces

- **Direktori Root**: `tallero-services/`
  - `be-tallero-web/`: Repositori Backend API (Express 5, Node.js ESM, PostgreSQL 16, Prisma 7).
  - `fe-tallero-web/`: Repositori Frontend Web (Next.js 16 App Router, React 19, Tailwind CSS v4).
  - `mobile/`: **BELUM TERSEDIA / TIDAK DITEMUKAN** di direktori kerja saat ini.
  - Paket Bersama (_Shared Packages / Monorepo Workspaces_): **TIDAK ADA**. Proyek tidak menggunakan pnpm/yarn/npm/turborepo workspaces terpadu; kedua direktori dikelola secara independen dengan `package.json` masing-masing.

### B. Versi Dependensi Kunci & Library

| Komponen                | Backend (`be-tallero-web`)                  | Frontend Web (`fe-tallero-web`)                 | Mobile (Expo)  | Catatan Kritis                                                                             |
| :---------------------- | :------------------------------------------ | :---------------------------------------------- | :------------- | :----------------------------------------------------------------------------------------- |
| **Framework / Runtime** | Node.js LTS (ESM), Express `5.2.1`          | Next.js `16.3.0` (App Router)                   | _Belum dibuat_ | FE Web memakai **Next.js App Router**, bukan Vite seperti asumsi awal di template panduan. |
| **React**               | N/A                                         | `19.2.8` (React 19)                             | _N/A_          | React 19 stabil dengan compiler terkini.                                                   |
| **Vite**                | `vitest` `3.0.5` (test runner)              | **Tidak Digunakan**                             | _N/A_          | Bundler FE menggunakan Turbopack / Next.js internal, bukan Vite.                           |
| **Styling**             | N/A                                         | Tailwind CSS `^4.0.0` (`@tailwindcss/postcss`)  | _N/A_          | Menggunakan CSS-first configuration Tailwind v4.                                           |
| **Expo / NativeWind**   | `expo-server-sdk` `8.0.0` (push server)     | **Tidak Digunakan**                             | _Belum dibuat_ | Modul mobile native belum diinisialisasi di repositori ini.                                |
| **Routing**             | Express 5 Router (`/api/v1/*`)              | Next.js App Router (`next/navigation`, `app/*`) | _Belum dibuat_ | Bersifat file-based routing di FE.                                                         |
| **State Management**    | In-memory session tokens + PostgreSQL       | React Component State (`useState`)              | _Belum dibuat_ | Belum ada global store (Zustand/Redux/Context API).                                        |
| **Form & Validasi**     | `zod` `^4.4.3` via middleware `validate.js` | Form HTML native uncontrolled/controlled        | _Belum dibuat_ | FE belum memiliki skema validasi client-side maupun `react-hook-form`.                     |
| **HTTP Client (Axios)** | Direct HTTP / Native fetch                  | `axios` `^1.20.0` terpasang di `lib/api.ts`     | _Belum dibuat_ | Instance Axios ada namun **belum di-import atau dipakai** di halaman manapun.              |

---

## 2. Inventaris Halaman Web & Status Layar

| No  | Halaman / Layar                       | Path File                      | Role               | Data yang Ditampilkan                                                                                                                                         | Aksi yang Tersedia                                                                                                                                                        | Status Integrasi Saat Ini                                                                                      |
| :-- | :------------------------------------ | :----------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------- |
| 1   | **Landing Page**                      | `app/page.tsx`                 | Publik             | Kontak bengkel, banner hero, 6 paket servis unggulan, kategori tab, merk mobil rekanan, 3 testimoni, 3 artikel tips otomotif, garansi & FAQ.                  | Filter tab kategori servis, bookmark paket, form reservasi cepat (cabang, servis, tanggal), link registrasi & login.                                                      | **STATIS / MOCK**<br>(Data di-hardcode dalam array file, 0 panggilan API).                                     |
| 2   | **Login Page**                        | `app/login/page.tsx`           | Publik / All Roles | Form input email & password, logo bengkel, tagline, link pendaftaran.                                                                                         | Input email & password, toggle password visibility, submit login (hanya `console.log`), link ke `/register`.                                                              | **STATIS / DUMMY**<br>(Tidak ada request auth ke BE, melanggar aturan keamanan logging).                       |
| 3   | **Register Page**                     | `app/register/page.tsx`        | Publik (Customer)  | Form input nama, email, password, ulangi password, branding bengkel.                                                                                          | Input data formulir, toggle password visibility, submit form (`console.log`), link ke `/login`.                                                                           | **STATIS / DUMMY**<br>(Tidak memanggil API, kurang input nomor telepon, alur OTP belum ada).                   |
| 4   | **Customer Dashboard & Booking**      | `app/user/dashboard/page.tsx`  | Customer           | Banner selector kendaraan, kartu tiket servis aktif (`TL-8821`), katalog paket servis lengkap, keranjang checkout, modal pelacak progres servis.              | Pilih brand/model/tahun mobil & cabang, cari & filter servis, bookmark, tambah/hapus keranjang, submit booking dummy (`handleConfirmBooking`), buka modal progres servis. | **MOCK / SIMULASI CLIENT-SIDE**<br>(100% React state lokal, generate kode acak `TL-XXXX`, tanpa integrasi BE). |
| 5   | **Admin Dashboard**                   | `app/admin/dashboard/page.tsx` | Admin              | Filter cabang aktif, 4 ringkasan metrik statistik operasional, tabel antrean servis hari ini, status kapasitas pit (Pit 1, Pit 2, Pit 5), akses pintas admin. | Ganti cabang di dropdown lokal, tombol "Booking Baru" & "Lihat Semua" ke `/admin/bookings`, link ke layanan & outlet.                                                     | **STATIS / MOCK**<br>(Semua metrik dan baris tabel di-hardcode di file).                                       |
| 6   | **Admin Kelola Booking**              | `app/admin/bookings/page.tsx`  | Admin              | Tabel daftar booking (kode, waktu, pelanggan, telepon, kendaraan, plat, layanan, estimasi harga, status, mekanik, catatan keluhan), modal detail booking.     | Filter status, input pencarian, tombol export, ubah status pengerjaan via dropdown select, lihat detail modal.                                                            | **MOCK / SIMULASI CLIENT-SIDE**<br>(Array mock 4 booking, ubah status hanya memutasi React state lokal).       |
| 7   | **Admin Data Outlet**                 | `app/admin/outlets/page.tsx`   | Admin              | Kartu outlet bengkel (kode cabang, nama, alamat, kepala cabang, telepon, kapasitas pit, jam operasional, status aktif), total cabang.                         | Pencarian cabang/alamat, tombol tambah outlet baru (placeholder), tombol edit outlet, tombol lihat jadwal pit.                                                            | **STATIS / MOCK**<br>(Data array statis, tanpa integrasi CRUD).                                                |
| 8   | **Admin Layanan Servis**              | `app/admin/services/page.tsx`  | Admin              | Kartu paket layanan (badge, kategori, judul, spesifikasi, harga, durasi, gambar, status aktif, checklist pengerjaan), modal form tambah/edit.                 | Pencarian layanan, filter kategori & status aktif, buka form tambah, edit layanan, toggle status aktif/nonaktif, edit checklist, simpan/hapus layanan.                    | **MOCK / SIMULASI CLIENT-SIDE**<br>(State CRUD lokal di memori, tanpa komunikasi API backend).                 |
| 9   | **Layar Mobile (Customer & Mekanik)** | _N/A (Belum Ada)_              | Customer & Mekanik | Katalog, QR check-in, tracking status, approval item perbaikan, pembayaran Snap Midtrans, antrean pit staf, klaim pekerjaan mekanik.                          | Reservasi servis, scan QR check-in, setujui/tolak biaya tambahan, ambil pekerjaan mekanik, unggah foto kondisi pengerjaan.                                                | **BELUM TERSEDIA**<br>(Proyek aplikasi mobile belum diinisialisasi di monorepo).                               |

---

## 3. Peta Kecocokan Endpoint Backend (Matrix Audit)

| Layar / Fitur                | Role Pengguna | Kebutuhan Aksi / Data                  | Endpoint BE yang Dibutuhkan             | Status BE             | Catatan & Analisis Gap                                                                                                                                                                   |
| :--------------------------- | :------------ | :------------------------------------- | :-------------------------------------- | :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Autentikasi (Login)**      | Publik / All  | Autentikasi sesi kredensial pengguna   | `POST /api/v1/auth/login`               | **ADA**               | BE mengembalikan JWT access token (15 mnt) & refresh token cookie/body. FE belum memanggil endpoint ini.                                                                                 |
| **Autentikasi (Sesi Aktif)** | Authenticated | Ambil profil user login saat boot app  | `GET /api/v1/auth/me`                   | **ADA**               | BE menyediakan data user dan role. Perlu dipanggil oleh auth context FE.                                                                                                                 |
| **Autentikasi (Logout)**     | Authenticated | Cabut refresh token dan hapus sesi     | `POST /api/v1/auth/logout`              | **ADA**               | Tombol "Keluar" di sidebar admin saat ini belum memiliki handler.                                                                                                                        |
| **Pendaftaran (Register)**   | Publik        | Pendaftaran akun baru customer         | `POST /api/v1/auth/register`            | **KURANG FIELD**      | BE mewajibkan `phone` (format seluler +628...) dan password minimal 8 karakter kombinasi huruf+angka. Form FE saat ini tidak memiliki input `phone`.                                     |
| **Verifikasi OTP**           | Publik        | Aktivasi akun baru dengan kode 6 digit | `POST /api/v1/auth/verify-otp`          | **TIDAK ADA DI FE**   | Endpoint BE sudah lengkap dengan proteksi HMAC & rate limit, tetapi FE belum memiliki layar/modal input OTP pendaftaran.                                                                 |
| **Kirim Ulang OTP**          | Publik        | Kirim ulang kode OTP jika kedaluwarsa  | `POST /api/v1/auth/resend-otp`          | **TIDAK ADA DI FE**   | Endpoint BE siap (cooldown 60 detik). FE belum menyediakan tombol resend.                                                                                                                |
| **Landing Page**             | Publik        | Daftar kategori layanan bengkel        | `GET /api/v1/categories`                | **ADA**               | Tersedia di BE untuk mengisi tab filter kategori dinamis.                                                                                                                                |
| **Landing Page**             | Publik        | Katalog daftar layanan publik          | `GET /api/v1/services`                  | **ADA**               | Menggantikan array mock `servicePackages` di `app/page.tsx`.                                                                                                                             |
| **Landing Page**             | Publik        | Daftar cabang bengkel aktif            | `GET /api/v1/outlets`                   | **ADA**               | Mengisi dropdown cabang pada quick booking bar.                                                                                                                                          |
| **Landing Page**             | Publik        | Ulasan publik pelanggan per cabang     | `GET /api/v1/outlets/{id}/reviews`      | **ADA**               | Menggantikan array mock `testimonials`.                                                                                                                                                  |
| **Customer Dashboard**       | Customer      | Mengambil kendaraan milik pelanggan    | `GET /api/v1/vehicles`                  | **ADA**               | Diperlukan agar banner pemilih kendaraan mengambil kendaraan riil pengguna, bukan mock Honda HR-V.                                                                                       |
| **Customer Dashboard**       | Customer      | Menambahkan kendaraan baru             | `POST /api/v1/vehicles`                 | **ADA**               | Dibutuhkan modal/form tambah kendaraan (`plateNumber`, `brand`, `model`, `type`).                                                                                                        |
| **Customer Dashboard**       | Customer      | Ketersediaan slot tanggal & jam servis | `GET /api/v1/outlets/{id}/availability` | **ADA**               | Parameter `?date=YYYY-MM-DD`. Mengembalikan daftar slot `AVAILABLE`, `LIMITED`, `FULL`, `CLOSED`.                                                                                        |
| **Customer Dashboard**       | Customer      | Submit pemesanan booking servis        | `POST /api/v1/bookings`                 | **KURANG FIELD (FE)** | BE butuh `outletId`, `vehicleId`, `scheduledAt` (ISO 8601), dan `items: [{ type, serviceId, quantity }]`. Form FE saat ini mengirim text brand, model, plat bebas, dan waktu terpisah.   |
| **Customer Dashboard**       | Customer      | Menampilkan status tiket booking aktif | `GET /api/v1/bookings`                  | **ADA**               | Filter `status=PENDING,CHECKED_IN,IN_PROGRESS,WAITING_APPROVAL,READY_FOR_PICKUP`.                                                                                                        |
| **Customer Dashboard**       | Customer      | Pelacak status servis realtime         | Socket.IO `booking:status_changed`      | **ADA**               | BE memancarkan event Socket.IO ke room `user:{userId}`. FE belum menginisialisasi socket client.                                                                                         |
| **Admin Dashboard**          | Admin         | Statistik ringkasan operasional        | `GET /api/v1/admin/dashboard`           | **ADA**               | BE mengembalikan metrik pendapatan, total booking hari ini per status, perbandingan pertumbuhan, dan mekanik aktif.                                                                      |
| **Admin Dashboard**          | Admin         | Daftar pengerjaan unit aktif hari ini  | `GET /api/v1/bookings`                  | **ADA**               | Parameter query `outletId`, `date`, dan status aktif.                                                                                                                                    |
| **Admin Kelola Booking**     | Admin         | Daftar seluruh booking dengan filter   | `GET /api/v1/bookings`                  | **ADA**               | Mendukung pagination (`page`, `limit`), `status`, `search`, dan `sort`.                                                                                                                  |
| **Admin Kelola Booking**     | Admin         | Detail data booking lengkap            | `GET /api/v1/bookings/{id}`             | **ADA**               | Mengembalikan relasi user, vehicle, items snapshot, logs, photos, dan payment.                                                                                                           |
| **Admin Kelola Booking**     | Admin         | Ubah status pengerjaan booking         | Multiple Endpoints State Machine        | **TIDAK ADA DI FE**   | **Gap Kritis**: BE tidak mengizinkan dropdown update status bebas. Transisi status wajib melalui: `check-in`, `start`, `ready`, `complete`, `cancel`. FE harus menyesuaikan tombol aksi. |
| **Admin Kelola Booking**     | Admin         | Export data booking ke Excel / CSV     | `GET /api/v1/admin/reports/export`      | **ADA**               | Parameter `?type=bookings&format=excel`. Sanitasi formula injection sudah aktif di BE.                                                                                                   |
| **Admin Data Outlet**        | Admin         | Daftar seluruh cabang outlet           | `GET /api/v1/admin/outlets`             | **ADA**               | Mendukung query pagination dan filter status `isActive`.                                                                                                                                 |
| **Admin Data Outlet**        | Admin         | Tambah outlet bengkel baru             | `POST /api/v1/admin/outlets`            | **ADA**               | Membutuhkan field jadwal operasional, latitude, longitude, slotMinutes, dan slotCapacity.                                                                                                |
| **Admin Data Outlet**        | Admin         | Perbarui informasi outlet              | `PATCH /api/v1/admin/outlets/{id}`      | **ADA**               | Validasi skema parsial di BE.                                                                                                                                                            |
| **Admin Data Outlet**        | Admin         | Hapus outlet (Soft delete)             | `DELETE /api/v1/admin/outlets/{id}`     | **ADA**               | Ditolak otomatis jika masih ada booking aktif yang belum tuntas.                                                                                                                         |
| **Admin Layanan Servis**     | Admin         | Daftar kategori layanan                | `GET /api/v1/admin/categories`          | **ADA**               | Mendukung manajemen kategori master.                                                                                                                                                     |
| **Admin Layanan Servis**     | Admin         | Daftar katalog layanan servis          | `GET /api/v1/admin/services`            | **ADA**               | Menampilkan seluruh layanan termasuk status nonaktif dan soft-deleted.                                                                                                                   |
| **Admin Layanan Servis**     | Admin         | Tambah layanan baru                    | `POST /api/v1/admin/services`           | **KURANG FIELD (BE)** | BE belum memiliki kolom `badge` ('TERLARIS'), `imageUrl`, dan `checklist` (rincian poin servis) yang ditampilkan di FE.                                                                  |
| **Admin Layanan Servis**     | Admin         | Perbarui data layanan servis           | `PATCH /api/v1/admin/services/{id}`     | **KURANG FIELD (BE)** | Perlu sinkronisasi field tambahan antara DB Prisma dan skema Zod.                                                                                                                        |
| **Admin Layanan Servis**     | Admin         | Hapus layanan (Soft delete)            | `DELETE /api/v1/admin/services/{id}`    | **ADA**               | Soft delete aman (`deletedAt`), relasi historis booking tetap terjaga via snapshot.                                                                                                      |

---

## 4. Temuan Pelanggaran Aturan Keamanan (§5)

Berikut adalah pelanggaran aturan integrasi dan standar keamanan klien (§5 di `agent.md` dan `AGENTS.md`) yang teridentifikasi di repositori frontend saat ini:

1. **Penyimpanan Token Tidak Aman (`localStorage`)**:
   - **Lokasi**: [fe-tallero-web/lib/api.ts](file:///c:/Users/KIBO/OneDrive/Desktop/TugasXII/tallero-services/fe-tallero-web/lib/api.ts#L15)
   - **Pelanggaran**: Menggunakan `localStorage.getItem('token')`.
   - **Aturan §5**: Web dilarang menyimpan token di `localStorage`/`sessionStorage` (rentan XSS). Access token wajib disimpan di memori runtime JavaScript, sedangkan refresh token dikirim via cookie `httpOnly; Secure; SameSite=Strict` dengan header `X-Client: web` dan Axios `withCredentials: true`.

2. **Absennya Konfigurasi Kredensial & Header Klien Web**:
   - **Lokasi**: [fe-tallero-web/lib/api.ts](file:///c:/Users/KIBO/OneDrive/Desktop/TugasXII/tallero-services/fe-tallero-web/lib/api.ts#L5-L10)
   - **Pelanggaran**: Instance Axios tidak memiliki `withCredentials: true` dan tidak menyertakan header `X-Client: web`. Akibatnya browser tidak akan mengirimkan atau menerima cookie refresh token dari backend.

3. **URL Endpoint Hardcoded & Ketiadaan Dokumen Environment**:
   - **Lokasi**: [fe-tallero-web/lib/api.ts](file:///c:/Users/KIBO/OneDrive/Desktop/TugasXII/tallero-services/fe-tallero-web/lib/api.ts#L3)
   - **Pelanggaran**: Nilai fallback di-hardcode ke `'http://localhost:5000'` (tanpa path `/api/v1`).
   - **Aturan §5**: Dilarang memiliki URL hardcoded. Variabel lingkungan harus menyertakan `/api/v1` (mis. `NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1`). Proyek `fe-tallero-web` saat ini sama sekali **tidak memiliki file `.env` maupun `.env.example`**.

4. **Pencatatan Data Kredensial Sensitif ke Console (`console.log`)**:
   - **Lokasi 1**: [fe-tallero-web/app/login/page.tsx](file:///c:/Users/KIBO/OneDrive/Desktop/TugasXII/tallero-services/fe-tallero-web/app/login/page.tsx#L12) — Mencetak `formData` yang berisi `password` pengguna secara terbuka ke console browser.
   - **Lokasi 2**: [fe-tallero-web/app/register/page.tsx](file:///c:/Users/KIBO/OneDrive/Desktop/TugasXII/tallero-services/fe-tallero-web/app/register/page.tsx#L18) — Mencetak `password` dan `confirmPassword` ke console browser.
   - **Aturan §5**: Mutlak dilarang mencatat (_log_) password, token, atau OTP ke console.

5. **Ketiadaan Interceptor Refresh Token (Single-Flight)**:
   - **Lokasi**: `fe-tallero-web/lib/api.ts`
   - **Pelanggaran**: Belum ada response interceptor untuk menangani `HTTP 401 UNAUTHORIZED`. Sesuai aturan §5, jika request gagal 401, klien harus memicu mekanisme refresh token satu kali secara terkendali (_single-flight queue_) sebelum memutuskan logout bersih bila refresh gagal.

6. **Ketiadaan Penanganan Status Loading, Kosong (_Empty_), dan Error**:
   - Seluruh halaman FE saat ini langsung merender tabel/kartu statis tanpa penanganan state asinkron (`isLoading`, `isEmpty`, `isError`).

7. **Ketiadaan Debounce pada Input Pencarian**:
   - Filter pencarian pada `app/admin/bookings`, `app/admin/outlets`, `app/admin/services`, dan `app/user/dashboard` langsung memicu filter pada tiap ketukan keyboard tanpa pembatasan _debounce_.

---

## 5. Daftar Mock & Kode Lama yang Harus Dihapus

1. **`fe-tallero-web/app/page.tsx`**:
   - Hapus array konstan `servicePackages` (digantikan data dari `GET /api/v1/services`).
   - Hapus array konstan `testimonials` (digantikan data dari `GET /api/v1/outlets/{id}/reviews`).
   - Bersihkan state mock reservasi cepat yang tidak tersambung ke API.

2. **`fe-tallero-web/app/login/page.tsx`**:
   - Hapus `console.log('Login Submit:', formData)`.

3. **`fe-tallero-web/app/register/page.tsx`**:
   - Hapus `console.log('Register Submit:', formData)`.

4. **`fe-tallero-web/app/user/dashboard/page.tsx`**:
   - Hapus objek dummy `activeTicket` (`TL-8821`, Avanza Veloz, progres 70%).
   - Hapus array mock `allServiceItems` (item dengan id `pkg-tuneup`, `pkg-oli-sintetik`, dll.).
   - Hapus struktur `vehicleModelsByBrand` mock hardcoded.
   - Hapus logika `handleConfirmBooking` yang mengenerate kode fiktif `TL-XXXX` di memori browser.
   - Hapus simulasi lokal modal status pengerjaan yang statis.

5. **`fe-tallero-web/app/admin/dashboard/page.tsx`**:
   - Hapus data metrik statis (Total Booking: 18, Antrean: 5, Sedang Dikerjakan: 4, Servis Selesai: 9).
   - Hapus array dummy `activeBookings` (4 item mock: Budi Santoso, Deni Kurniawan, Rina Wijaya, Siti Hawa).
   - Hapus data status pit statis (Pit 1, Pit 2, Pit 5).

6. **`fe-tallero-web/app/admin/bookings/page.tsx`**:
   - Hapus array state `bookings` (4 booking mock: `TL-8821`, `TL-8822`, `TL-8820`, `TL-8819`).
   - Hapus fungsi `handleStatusChange` yang memanipulasi status di state lokal tanpa melewati state machine backend.

7. **`fe-tallero-web/app/admin/outlets/page.tsx`**:
   - Hapus array statis `outlets` (`OUT-01`, `OUT-02`, `OUT-03`).

8. **`fe-tallero-web/app/admin/services/page.tsx`**:
   - Hapus array statis `initialPackages` (`srv-1` s/d `srv-5`).
   - Hapus array `categoryOptions` hardcoded.
   - Hapus manipulasi lokal penambahan/pengeditan item di state React tanpa sinkronisasi DB.

9. **`fe-tallero-web/lib/api.ts`**:
   - Ganti implementasi instance axios lama dengan arsitektur axios client aman (in-memory token + httpOnly cookie + interceptor single-flight).

---

## 6. Daftar Ketidakcocokan Alur Bisnis (_Flow Discrepancies_) & Usulan Penyelesaian

### 1. Ketidakcocokan Siklus Hidup Status Booking (State Machine vs Bebas Pilih Dropdown)

- **Gejala / Masalah**:
  Pada layar Admin Booking (`/admin/bookings`), antarmuka menyediakan elemen `<select>` di mana admin dapat secara instan mengubah status antara `"Menunggu"`, `"Diproses"`, dan `"Selesai"`. Di Backend, tidak tersedia endpoint untuk mengubah status secara bebas. Status booking dikendalikan secara mutlak oleh `bookingStateMachine.js` dengan transisi bersyarat (`WHERE id = :id AND status = :fromStatus`):
  - `PENDING` $\rightarrow$ `CHECKED_IN` (hanya via scan QR check-in staf).
  - `CHECKED_IN` $\rightarrow$ `IN_PROGRESS` (hanya via mekanik mulai servis / claim-next).
  - `IN_PROGRESS` $\rightarrow$ `WAITING_APPROVAL` (hanya saat ada rekomendasi suku cadang tambahan).
  - `WAITING_APPROVAL` $\rightarrow$ `IN_PROGRESS` (hanya setelah customer menyetujui/menolak).
  - `IN_PROGRESS` $\rightarrow$ `READY_FOR_PICKUP` (hanya saat mekanik menandai pekerjaan beres).
  - `READY_FOR_PICKUP` $\rightarrow$ `COMPLETED` (hanya via kasir/admin setelah pembayaran `PAID`).
- **Usulan Penyelesaian**:
  - Ganti elemen dropdown status di tabel/modal booking admin dengan tombol aksi kontekstual yang mencerminkan aksi sah berikutnya:
    - Jika status `PENDING`: Tampilkan tombol "Check-in Manual" atau "Batalkan".
    - Jika status `CHECKED_IN`: Tampilkan tombol "Tugaskan Mekanik" / "Mulai Servis" (`POST /bookings/:id/start`).
    - Jika status `IN_PROGRESS`: Tampilkan tombol "Tandai Siap Diambil" (`POST /bookings/:id/ready`).
    - Jika status `READY_FOR_PICKUP`: Periksa status pembayaran. Jika lunas (`PAID`), tampilkan tombol "Selesaikan Booking" (`POST /bookings/:id/complete`); jika belum lunas, arahkan ke tombol "Proses Pembayaran Kasir".
  - Pada Fase I-1 (perbaikan BE), bila admin memang memerlukan wewenang intervensi khusus untuk mengubah status abnormal, buat endpoint admin tersendiri (`POST /api/v1/admin/bookings/:id/force-status`) yang mewajibkan input alasan pembatalan/perubahan dan mencatatnya ke `AuditLog`.

---

### 2. Ketidakcocokan Pendaftaran Servis & Kendaraan (Form Bebas vs Relasi User-Vehicle)

- **Gejala / Masalah**:
  Pada `/user/dashboard`, pelanggan memilih merk dan model mobil lalu mengetik plat nomor baru langsung di formulir checkout booking. Di Backend, pembuatan booking (`POST /api/v1/bookings`) mewajibkan `vehicleId` integer yang sudah terdaftar atas nama pelanggan tersebut di tabel `Vehicle`.
- **Usulan Penyelesaian**:
  - Di halaman user dashboard, panggil `GET /api/v1/vehicles` saat komponen dimuat untuk mengisi dropdown daftar kendaraan milik user.
  - Sediakan opsi "Daftarkan Kendaraan Baru" di dropdown tersebut. Jika dipilih, buka modal pop-up pendaftaran kendaraan (`POST /api/v1/vehicles`) yang menyimpan data kendaraan ke profil user, lalu otomatis mengembalikan `vehicleId` untuk dipakai pada formulir reservasi booking.

---

### 3. Ketidakcocokan Format Jadwal Booking & Validasi Ketersediaan Slot

- **Gejala / Masalah**:
  Frontend memecah jadwal menjadi string tanggal terpisah (`bookingDate: '2026-11-16'`) dan opsi waktu teks statis (`bookingTime: '10:00 WIB'`). Backend mewajibkan field tunggal `scheduledAt` berformat UTC ISO 8601 dan menolak request jika kapasitas slot pada jam tersebut telah habis (`SLOT_FULL`).
- **Usulan Penyelesaian**:
  - Saat pelanggan memilih tanggal di kalender UI, kirim request ke `GET /api/v1/outlets/{id}/availability?date=YYYY-MM-DD`.
  - Render tombol pilihan jam secara dinamis berdasarkan respons slot: nonaktifkan (_disable_) slot berlabel `FULL` atau `CLOSED`, dan tandai slot yang berlabel `LIMITED` atau `AVAILABLE`.
  - Saat checkout, gabungkan tanggal dan slot jam ke dalam format ISO string dengan timezone `Asia/Jakarta` (mis. `2026-11-16T10:00:00+07:00`) untuk dikirim sebagai `scheduledAt`.

---

### 4. Ketidakcocokan Struktur Data Layanan Servis (_Service Catalog Field Gap_)

- **Gejala / Masalah**:
  Frontend menampilkan field pemasaran pada kartu layanan:
  - `badge`: Label seperti `'TERLARIS'`, `'PROMO'`, `'HEMAT'`.
  - `imageUrl`: URL gambar ilustrasi servis.
  - `checklist`: Array string langkah-langkah servis yang dikerjakan.
  - `specs`: Ringkasan spesifikasi servis.
    Model `Service` di Backend saat ini hanya memiliki kolom: `id`, `categoryId`, `name`, `description`, `price`, `estimatedMinutes`, `vehicleType`, `reminderIntervalDays`, `reminderIntervalKm`, `isActive`.
- **Usulan Penyelesaian**:
  - Pada **Fase I-1 (Gap Fixing BE)**: Perbarui schema Prisma model `Service` dengan menambahkan:
    - `badge String?`
    - `imageUrl String?`
    - `checklist Json?` (array string)
    - Perbarui skema validasi Zod (`createServiceSchema` & `updateServiceSchema`), jalankan `prisma migrate dev`, update dokumentasi OpenAPI & koleksi Postman, serta pastikan seluruh tes backend tetap lulus.
  - Di sisi Frontend: Saat menampilkan atau mengedit layanan, gunakan `categoryId` integer asli dari `GET /api/v1/categories`, bukan string nama kategori bebas.

---

### 5. Ketidakcocokan Alur Registrasi Akun Pelanggan (OTP Verification Gap)

- **Gejala / Masalah**:
  Formulir pendaftaran akun di FE (`/register`) hanya memiliki input Nama, Email, Password, dan Ulangi Password, lalu mengasumsikan pendaftaran langsung selesai dan aktif. Backend menetapkan aturan keamanan ketat:
  1. `phone` wajib diisi dan harus nomor seluler Indonesia valid (+628...).
  2. Registrasi awal via `POST /api/v1/auth/register` membuat akun dengan `isVerified: false` dan otomatis mengirimkan 6-digit OTP ke email via Nodemailer/Gmail.
  3. Akun baru bisa login setelah diverifikasi melalui `POST /api/v1/auth/verify-otp { email, otp }`.
- **Usulan Penyelesaian**:
  - Tambahkan input nomor telepon seluler pada form `/register`.
  - Setelah form registrasi sukses di-submit (201 Created), arahkan UI ke langkah 2: Tampilkan modal atau layar input kode OTP 6-digit.
  - Sediakan timer hitung mundur 60 detik untuk tombol kirim ulang OTP (`POST /api/v1/auth/resend-otp`).
  - Setelah OTP berhasil diverifikasi, alihkan pelanggan ke halaman `/login` dengan notifikasi sukses.

---

### 6. Ketidakcocokan Informasi Outlet Bengkel (Field Manager / Kepala Cabang)

- **Gejala / Masalah**:
  Kartu outlet di `/admin/outlets` menampilkan informasi "Kepala Cabang / Manager". Di schema DB backend, entitas `Outlet` tidak memiliki kolom `managerName` atau relasi khusus `managerId` (staf bengkel terhubung melalui relasi balik `User.outletId`).
- **Usulan Penyelesaian**:
  - Pada Fase I-1, perbarui endpoint detail/daftar outlet di backend agar menyertakan data staf ber-role `ADMIN` yang terdaftar pada cabang tersebut, atau tambahkan kolom `managerName String?` pada model `Outlet`.

---

### 7. Status Ketiadaan Aplikasi Mobile di Direktori Kerja

- **Gejala / Masalah**:
  Seluruh panduan integrasi, dokumen `agent.md`, dan `AGENTS.md` menyebutkan konsumen API terdiri dari Web Admin dan Aplikasi Mobile (Expo/React Native). Namun direktori `mobile` belum ada di dalam workspace `tallero-services`.
- **Usulan Penyelesaian**:
  - Laporkan kepada pengguna bahwa audit integrasi Fase I-0 difokuskan pada sinkronisasi Web (Admin & Customer) dan Backend.
  - Rekomendasikan inisialisasi modul mobile berbasis Expo SDK 52 + NativeWind v4 pada sesi/fase tersendiri setelah integrasi dasar backend dan web admin selesai distabilkan.

---

## 7. Rangkuman Kesiapan Integrasi

1. **Backend (be-tallero-web)**:
   - 106 endpoint sudah terimplementasi penuh dengan skema Zod, controller, service berarsitektur bersih, dan 100% tersinkronisasi di OpenAPI & Postman.
   - Siap melayani integrasi segera setelah beberapa field gap minor (`badge`, `checklist`, `imageUrl`, `managerName`) ditambahkan pada Fase I-1.

2. **Frontend Web (fe-tallero-web)**:
   - Tampilan UI dan komponen Tailwind sudah sangat matang dan estetik.
   - Memerlukan refactoring layer komunikasi API: mengganti seluruh data mock dengan request asinkron Axios, menerapkan in-memory auth token store dengan httpOnly cookie, mengimplementasikan error boundary & loading state, serta menyesuaikan alur tombol aksi dengan state machine backend.
