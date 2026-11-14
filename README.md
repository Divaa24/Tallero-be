# Tallero Auto — Backend API

Backend RESTful API dan Realtime Service untuk bengkel **Tallero Auto**, melayani **Web Admin (React/Vite)** dan **Mobile App (Expo/React Native)**. Dibangun menggunakan Node.js LTS, Express 5 (JavaScript ESM), PostgreSQL 16, Prisma 7, Zod, Socket.IO, dan Midtrans Snap.

---

## 1. Prasyarat Sistem

- **Node.js** >= 20 LTS (`node -v`)
- **PostgreSQL** 16 (Lokal via `psql` atau `pgAdmin`, tanpa Docker)
- **Git**

---

## 2. Setup Database PostgreSQL (Lokal)

Sesuai aturan `AGENTS.md §1`, proyek ini menggunakan **dua database terpisah** agar automated test tidak menyentuh data development:

1. `tallero_dev` (atau `tallero_db`) — untuk development runtime (`DATABASE_URL`)
2. `tallero_test` (atau `tallero_test_db`) — untuk automated testing (`TEST_DATABASE_URL`)

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

Jalankan migrasi skema database dan populasi data awal:

```bash
# 1. Jalankan migrasi Prisma ke database development
npx prisma migrate dev

# 2. Jalankan seed data master dan demo transaksi
npm run db:seed
```

---

## 5. Menjalankan Server & Dokumentasi API

### Menjalankan Server Development

```bash
npm run dev
```

Server berjalan pada `http://localhost:5000`.

- **Liveness probe**: `GET http://localhost:5000/api/v1/health`
- **Readiness probe**: `GET http://localhost:5000/api/v1/ready`
- **Interactive Swagger UI**: Buka browser pada `http://localhost:5000/docs` (tersedia pada non-production).

### Ekspor OpenAPI Spec & Postman Collection

Spesifikasi OpenAPI dan koleksi Postman yang dilengkapi skrip auto-inject JWT token dapat diperbarui kapan saja melalui:

```bash
node scripts/generate-openapi.js
```

File hasil generasi:
1. `docs/openapi.json` — Spesifikasi OpenAPI 3.0.3 lengkap.
2. `docs/tallero-auto.postman_collection.json` — Koleksi Postman dengan pre-request script dan auto-token test script.
3. `docs/tallero-auto.postman_environment.json` — Konfigurasi environment lokal Postman.

---

## 6. Daftar Akun Demo Resmi

Seluruh password akun demo di-hash menggunakan `bcrypt` (cost 12) dan bersifat deterministik untuk mempermudah demonstrasi tim Frontend/Mobile:

| Role | Nama | Email | Password | Keterangan & Akses Fitur |
| :--- | :--- | :--- | :--- | :--- |
| **ADMIN** | Admin Pusat | `admin@tallero.test` | `AdminTallero123!` | Akses Dashboard Admin, Kasir Tunai, Master Data, Ekspor Laporan |
| **MECHANIC** | Bambang Prakoso | `bambang.mekanik@tallero.test` | `MekanikTallero123!` | Mekanik Cabang Barat (Antrian, Start, Tambah Item, Foto) |
| **MECHANIC** | Hendra Wijaya | `hendra.mekanik@tallero.test` | `MekanikTallero123!` | Mekanik Cabang Timur (Antrian, Start, Tambah Item, Foto) |
| **CUSTOMER** | Ahmad Fadillah | `ahmad.customer@tallero.test` | `CustomerTallero123!` | Customer (Booking PENDING siap Scan QR, Kendaraan Avanza Veloz) |
| **CUSTOMER** | Budi Santoso | `budi.customer@tallero.test` | `CustomerTallero123!` | Customer (Booking COMPLETED, Lunas Midtrans, Ulasan Bintang 5, HR-V) |
| **CUSTOMER** | Dewi Anggraini | `dewi.customer@tallero.test` | `CustomerTallero123!` | Customer (Booking WAITING_APPROVAL, menunggu persetujuan item tambahan) |

---

## 7. Setup Pembayaran Midtrans Sandbox & Webhook Lokal

Aplikasi menggunakan integrasi langsung HTTP Midtrans Snap API (tanpa SDK lama) dengan otorisasi Basic Auth (`Base64(MIDTRANS_SERVER_KEY + ":")`).

1. Daftar akun sandbox di [Midtrans Sandbox Portal](https://dashboard.sandbox.midtrans.com/).
2. Buka menu **Settings → Access Keys** dan salin **Server Key** serta **Client Key** ke `.env`.
3. Untuk menguji webhook notifikasi pembayaran di localhost, gunakan tunnel tools seperti `ngrok` atau `localtunnel`:
   ```bash
   npx ngrok http 5000
   ```
4. Buka **Settings → Configuration** di Midtrans Sandbox:
   - **Payment Notification URL**: `https://<subdomain-ngrok>.ngrok-free.app/api/v1/payments/midtrans/notification`
   - Klik **Update**.
5. Setiap transaksi settlement Midtrans akan memverifikasi `signature_key` SHA-512 dan konfirmasi ulang status resmi secara aman.

---

## 8. Setup Gmail OAuth2 (`EMAIL_DRIVER=gmail`)

Pada environment `development` dan `test`, `EMAIL_DRIVER=console` mencetak preview email ke log `pino`. Pada `production`, aplikasi **wajib** memakai `EMAIL_DRIVER=gmail` dengan Nodemailer OAuth2:

1. Buka **Google Cloud Console** (`https://console.cloud.google.com/`), buat atau pilih project, lalu aktifkan **Gmail API**.
2. Buka menu **APIs & Services → OAuth consent screen**:
   - Pilih tipe user (**External** untuk akun Gmail biasa).
   - Isi nama aplikasi, email support, dan tambahkan akun pengirim ke daftar _Test users_.
   - **PENTING:** Consent screen yang berstatus **Testing** menyebabkan `refresh_token` OAuth2 **kedaluwarsa setiap 7 hari**. Sebelum dipakai jangka panjang/production, klik **Publish App** agar status berubah menjadi **In production**.
3. Buka **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Tambahkan Authorized redirect URI: `https://developers.google.com/oauthplayground`.
   - Salin **Client ID** (`GMAIL_CLIENT_ID`) dan **Client Secret** (`GMAIL_CLIENT_SECRET`).
4. Buka **Google OAuth 2.0 Playground** (`https://developers.google.com/oauthplayground`):
   - Klik ikon gear (_Settings_) di kanan atas → centang **Use your own OAuth credentials** → masukkan Client ID & Client Secret Anda.
   - Pada langkah **Select & authorize APIs**, masukkan scope `https://mail.google.com/` → klik **Authorize APIs** dan login memakai akun Gmail pengirim (`GMAIL_USER`).
   - Klik **Exchange authorization code for tokens** → salin **Refresh token** (`GMAIL_REFRESH_TOKEN`).
5. Perbarui `.env`:
   ```env
   EMAIL_DRIVER=gmail
   GMAIL_USER=bengkel@gmail.com
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   GMAIL_REFRESH_TOKEN=...
   ```

---

## 9. Menjalankan Tes & Pemeriksaan Kualitas

Proyek ini dilengkapi dengan suite pengujian unit dan integrasi otomatis yang ketat:

```bash
# 1. Jalankan linter dan validator struktur folder
npm run lint

# 2. Jalankan validasi skema Prisma
npx prisma validate

# 3. Jalankan automated test vitest
npm test
```

---

## 10. Referensi Dokumentasi Tambahan

- [docs/FLOW.md](docs/FLOW.md) — Diagram alur visual Mermaid: Alur Customer, Alur Staf Bengkel, State Machine Booking, Alur Pembayaran Midtrans, Row Locking Antrian, dan Rotasi Token.
- [docs/API.md](docs/API.md) — Ringkasan kontrak API, format envelope respons, daftar kode error, event realtime Socket.IO, format QR Code, dan panduan penggunaan signed URL.
- [docs/DECISIONS.md](docs/DECISIONS.md) — Daftar catatan keputusan arsitektur (Architecture Decision Records / ADR-001 s/d ADR-018).
