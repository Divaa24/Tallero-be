# Tallero Auto — Backend API

Backend RESTful API dan Realtime Service untuk bengkel **Tallero Auto**, melayani **Web Admin (React/Next.js)** dan **Mobile App (Expo/React Native)**. Dibangun menggunakan Node.js LTS, Express 5 (JavaScript ESM), PostgreSQL 16, Prisma 7, Zod, Socket.IO, dan Midtrans Snap.

Hasil perbaikan, penggunaan database lokal, pengujian transaksi, dan batasan integrasi eksternal terbaru: [Verifikasi 18 November 2026](docs/VERIFICATION_2026-11-18.md). Frontend lokal berjalan di `http://localhost:3000`; backend di port 5000. Gunakan `TEST_DATABASE_URL` yang terpisah untuk automated test. Initial migration hanya diterapkan pada database baru; database lama tidak direset.

---

## 📌 Panduan Integrasi Khusus Tim Frontend & Mobile

Bagi tim pengembang Frontend Web dan Mobile Apps, seluruh dokumen kontrak teknis resmi telah disusun secara komprehensif di folder `docs/`.

### Urutan Membaca Dokumen (Reading Order):

1. [docs/ENDPOINTS.md](docs/ENDPOINTS.md) — Tabel ringkas seluruh **106 endpoint**, role yang berhak, dan tag Klien (`WEB` / `MOBILE` / `KEDUANYA`).
2. [docs/DATA_MODELS.md](docs/DATA_MODELS.md) — Format model data (User, Booking, Outlet, dll.), seluruh enum, format integer Rupiah, dan tanggal UTC ISO.
3. [docs/AUTH_FLOW.md](docs/AUTH_FLOW.md) — Alur login, cookie HTTP-only (Web) vs SecureStore (Mobile), OTP, rotasi token, dan single-flight interceptor.
4. [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) — State machine pengerjaan bengkel (Mermaid diagram), aturan antrean, dan seluruh konstanta `rules.js`.
5. [docs/API.md](docs/API.md) — Rujukan teknis lengkap per endpoint (request body, response JSON nyata, daftar error, dan penanganan UI).
6. [docs/PAYMENTS.md](docs/PAYMENTS.md) — Alur pembayaran online Midtrans Snap, kasir tunai, uang tip mekanik, faktur PDF, dan sandbox setup.
7. [docs/REALTIME.md](docs/REALTIME.md) — Integrasi WebSocket Socket.IO, autentikasi handshake, isolasi room, katalog event, dan strategi refetch.
8. [docs/FILES.md](docs/FILES.md) — Tata cara upload foto/avatar, penanganan Signed URL kedaluwarsa, dan unduhan berkas blob.
9. [docs/SCREEN_ENDPOINT_MAP.md](docs/SCREEN_ENDPOINT_MAP.md) — Usulan pemetaan layar Web Admin & Mobile App terhadap endpoint pendukungnya.
10. [docs/FE_MATCHING_TEMPLATE.md](docs/FE_MATCHING_TEMPLATE.md) — Template verifikasi pencocokan field & enum yang wajib diisi selama proses slicing UI.
11. [docs/CHANGELOG_BACKEND.md](docs/CHANGELOG_BACKEND.md) — Catatan riwayat fitur v1.0.0 dan batasan teknis sistem.

---

## 1. Prasyarat Sistem

- **Node.js** >= 20 LTS (`node -v`)
- **PostgreSQL** 16 (Lokal via `psql` atau `pgAdmin`, tanpa Docker)
- **Git**

---

## 2. Setup Database PostgreSQL (Lokal)

Sesuai aturan `AGENTS.md §1`, proyek ini menggunakan **dua database terpisah** agar automated test tidak menyentuh data development:

1. `tallero_dev` — untuk development runtime (`DATABASE_URL`)
2. `tallero_test` — untuk automated testing (`TEST_DATABASE_URL`)

### Menggunakan PostgreSQL CLI (`psql`)

Buka terminal / PowerShell dan jalankan perintah berikut:

```bash
# Masuk ke psql dengan user postgres
psql -U postgres

# Buat database development
CREATE DATABASE tallero_dev;

# Buat database test
CREATE DATABASE tallero_test;

# Keluar dari psql
\q
```

---

## 3. Instalasi & Konfigurasi Environment

1. **Clone repository dan salin file konfigurasi:**

   ```bash
   cp .env.example .env
   ```

2. **Instal seluruh dependensi:**

   ```bash
   npm install
   ```

3. **Konfigurasi `.env`:**

   Pastikan variabel wajib berikut terisi dengan benar (seluruh secret wajib $\ge 32$ karakter):

   ```env
   NODE_ENV=development
   PORT=5000
   TIMEZONE=Asia/Jakarta

   # Database Connection Strings
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tallero_dev?schema=public"
   TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tallero_test?schema=public"

   # Keamanan & Kriptografi (Minimal 32 Karakter)
   JWT_SECRET="tallero-ultra-secure-jwt-secret-key-32chars-min"
   SIGNED_URL_SECRET="tallero-signed-url-secret-key-32chars-min"
   OTP_HMAC_SECRET="tallero-otp-hmac-secret-key-32chars-min"
   QR_SECRET="tallero-qr-code-secret-key-32chars-min"

   # Kredensial Seed Admin Awal
   SEED_ADMIN_NAME="Admin Pusat"
   SEED_ADMIN_EMAIL="admin@tallero.test"
   SEED_ADMIN_PASSWORD="AdminTallero123!"
   SEED_ADMIN_PHONE="+628119999001"

   # Email Driver (console untuk dev/test, gmail untuk production)
   EMAIL_DRIVER=console

   # Midtrans Payment Gateway (Sandbox)
   MIDTRANS_SERVER_KEY="SB-Mid-server-YOUR_SANDBOX_KEY"
   MIDTRANS_CLIENT_KEY="SB-Mid-client-YOUR_SANDBOX_KEY"
   MIDTRANS_IS_PRODUCTION=false

   # CORS Allowed Origins
   CORS_ORIGINS="http://localhost:5173,http://localhost:3000,http://localhost:19006"
   ```

---

## 4. Migrasi Database & Seeding Data Demo

Jalankan migrasi skema database dan populasi data awal secara otomatis:

```bash
# 1. Jalankan migrasi Prisma ke database development
npx prisma migrate dev

# 2. Jalankan seed data master dan transaksi demo lengkap
npm run db:seed
```

---

## 5. Menjalankan Server & Dokumentasi API Interaktif

### Menjalankan Server Development

```bash
npm run dev
```

Server berjalan pada port `http://localhost:5000`:

- **Liveness probe**: `GET http://localhost:5000/api/v1/health`
- **Readiness probe**: `GET http://localhost:5000/api/v1/ready`
- **Interactive Swagger UI**: Buka peramban pada **`http://localhost:5000/docs`** (tersedia pada mode non-production).

### Ekspor OpenAPI Spec & Postman Collection

Spesifikasi OpenAPI dan koleksi Postman yang dilengkapi skrip otomatis injeksi token Bearer dapat diperbarui kapan saja melalui:

```bash
node scripts/generate-openapi.js
```

File hasil ekspor yang siap digunakan:

1. `docs/openapi.json` — Spesifikasi OpenAPI 3.0.3 lengkap (106 endpoint).
2. `docs/tallero-auto.postman_collection.json` — Koleksi Postman siap impor dengan alur autentikasi otomatis.
3. `docs/tallero-auto.postman_environment.json` — Variabel environment Postman lokal.

---

## 6. Daftar Akun Demo Resmi untuk Pengujian FE

Seluruh password akun demo di-hash menggunakan `bcrypt` (cost 12) dan bersifat deterministik untuk mempermudah login tim Frontend & Mobile:

| Role         | Nama            | Email                          | Password              | Cabang / Akses Fitur                                            |
| :----------- | :-------------- | :----------------------------- | :-------------------- | :-------------------------------------------------------------- |
| **ADMIN**    | Admin Pusat     | `admin@tallero.test`           | `AdminTallero123!`    | Akses Dashboard Admin, Kasir Tunai, Master Data, Ekspor Laporan |
| **MECHANIC** | Bambang Prakoso | `bambang.mekanik@tallero.test` | `MekanikTallero123!`  | Mekanik Cabang Barat (Antrian Pit, Start, Tambah Item, Foto)    |
| **MECHANIC** | Hendra Wijaya   | `hendra.mekanik@tallero.test`  | `MekanikTallero123!`  | Mekanik Cabang Timur (Antrian Pit, Start, Tambah Item, Foto)    |
| **CUSTOMER** | Ahmad Fadillah  | `ahmad.customer@tallero.test`  | `CustomerTallero123!` | Booking PENDING siap Scan QR, Kendaraan Avanza Veloz            |
| **CUSTOMER** | Budi Santoso    | `budi.customer@tallero.test`   | `CustomerTallero123!` | Booking COMPLETED, Lunas Midtrans, Ulasan Bintang 5             |
| **CUSTOMER** | Dewi Anggraini  | `dewi.customer@tallero.test`   | `CustomerTallero123!` | Booking WAITING_APPROVAL (menunggu approval item tambahan)      |

---

## 7. Setup Pembayaran Midtrans Sandbox & Webhook Lokal

Aplikasi menggunakan integrasi langsung HTTP Midtrans Snap API (tanpa SDK lama) dengan otorisasi Basic Auth.

1. Daftar akun sandbox di [Midtrans Sandbox Portal](https://dashboard.sandbox.midtrans.com/).
2. Buka menu **Settings → Access Keys** dan salin **Server Key** serta **Client Key** ke file `.env`.
3. Untuk menguji webhook notifikasi pembayaran di localhost, gunakan tunnel tools seperti `ngrok`:
   ```bash
   npx ngrok http 5000
   ```
4. Buka **Settings → Configuration** di Midtrans Sandbox:
   - **Payment Notification URL**: `https://<subdomain-ngrok>.ngrok-free.app/api/v1/payments/midtrans/notification`
   - Klik **Update**.
5. Klien Web/Mobile dapat menggunakan kartu kredit dan virtual account simulator resmi Midtrans untuk simulasi transaksi.

---

## 8. Menjalankan Tes & Pemeriksaan Kualitas Otomatis

Proyek ini dilengkapi dengan suite pengujian unit dan integrasi otomatis yang ketat:

```bash
# 1. Jalankan linter dan validator struktur folder
npm run lint

# 2. Jalankan pemeriksaan struktur folder dan penamaan service
npm run check:structure

# 3. Jalankan validasi skema Prisma
npx prisma validate

# 4. Jalankan automated test vitest
npm test
```

## Log development

Secara default `LOG_LEVEL=info` dan `LOG_SQL_QUERIES=false`. Request dicatat sebagai ID, method, path tanpa query string, status HTTP dan waktu respons. Header, cookie dan body tidak dicetak pada log HTTP. Peringatan/error tetap terlihat. Untuk menelusuri SQL di development, gunakan `LOG_LEVEL=debug` bersama `LOG_SQL_QUERIES=true`, lalu restart backend; parameter query tidak dicetak. Log SQL tidak diaktifkan untuk production.
