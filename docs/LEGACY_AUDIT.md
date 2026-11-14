# AUDIT KODE LAMA (LEGACY AUDIT) — TALLERO AUTO BACKEND

Dokumen ini disusun pada **Fase 0 (Langkah A — Screening)** untuk mengevaluasi codebase lama (snapshot commit `e26b789` / `_legacy/`) serta menyelaraskan kondisi working tree saat ini terhadap **aturan terbaru `AGENTS.md` §1–§11** sebelum eksekusi Langkah B.

---

## 1. Temuan Keamanan (Security Findings)

> [!CAUTION]
> Temuan berikut berasal dari codebase lama (commit `e26b789`, kini berada di `_legacy/`):

1. **Hardcoded Fallback Secret Ter-commit ke Git (`e26b789`):**
   - `_legacy/src/utils/jwt.util.js` dan `_legacy/src/middlewares/auth.middleware.js` menggunakan fallback hardcoded `process.env.JWT_SECRET || "rahasia_tallero_123"` (hanya 19 karakter, di bawah batas minimal 32 karakter pada `AGENTS.md §1`).
2. **Plaintext OTP & User Enumeration (`e26b789`):**
   - `_legacy/prisma/schema.prisma` menyimpan `otpCode` plaintext di tabel `users`.
   - `_legacy/src/controllers/auth.controller.js` memakai bcrypt cost 10, membocorkan `userId` saat register, serta mengembalikan respons berbeda untuk email yang sudah terverifikasi (`"Email already registered and verified."`).
3. **CORS & Socket.IO Terbuka Tanpa Autentikasi (`e26b789`):**
   - `_legacy/src/app.js` mengaktifkan `cors()` tanpa whitelist origin, Socket.IO `cors.origin: "*"` tanpa verifikasi JWT handshake, serta tanpa isolasi room.
4. **Upload Publik Tanpa Sanitasi Magic Bytes / EXIF (`e26b789`):**
   - `_legacy/src/middlewares/upload.middleware.js` menyimpan upload ke `public/uploads/` memakai `multer.diskStorage`, hanya memeriksa `file.mimetype`, tanpa pengecekan magic bytes (`file-type`), tanpa re-encoding `sharp`, dan diekspos statis via `/uploads`.
5. **Cascade Delete pada Tabel Transaksi (`e26b789`):**
   - `_legacy/prisma/schema.prisma` memasang `onDelete: Cascade` pada relasi `Service`, `Vehicle`, dan `Booking`, berisiko menghilangkan riwayat transaksi permanen.
6. **File `.env` Lokal:**
   - Hasil pemeriksaan `git ls-files .env*` menunjukkan `.env` **tidak** ter-commit ke git (sudah diabaikan oleh `.gitignore` sejak `e26b789`).

---

## 2. Tabel Audit: Item · Tindakan · Alasan

### A. Dependensi (`package.json`) & Konfigurasi Root

| Item                                                                                                                     | Tindakan                                          | Alasan                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `"type": "module"` (ESM)                                                                                                 | **Pertahankan / Wajibkan**                        | `AGENTS.md §1` mewajibkan JavaScript ESM murni tanpa TypeScript.                                                        |
| `express` (`^5.2.1`)                                                                                                     | **Dipertahankan**                                 | Sesuai stack Express 5 (`AGENTS.md §1`), dengan perbaikan `req.query` read-only.                                        |
| `zod` (`^4.4.3`)                                                                                                         | **Dipertahankan**                                 | Sesuai stack validasi (`AGENTS.md §1`), wajib memakai `error.issues` dan `.strict()`.                                   |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` (`^7.9.1` / `^8.22.0`)                                            | **Dipertahankan**                                 | Sesuai stack PostgreSQL 16 + Prisma 7 driver adapter (`prisma.config.ts`).                                              |
| `bcrypt` (`^6.0.0`), `jsonwebtoken` (`^9.0.3`), `cors`, `dotenv`, `multer`, `socket.io`                                  | **Dipertahankan & Diperketat**                    | `bcrypt` cost 12, JWT pin `HS256`, `cors` whitelist, `multer` memory, `socket.io` auth room.                            |
| `bcryptjs` (`^3.0.3`)                                                                                                    | **Dibuang**                                       | Duplikat dengan `bcrypt` native (`e26b789`).                                                                            |
| `resend` (`^6.22.0`)                                                                                                     | **Dibuang**                                       | Diganti Nodemailer + Gmail OAuth2 (`console` driver untuk dev) (`AGENTS.md §1`).                                        |
| `@google/generative-ai` (`^0.24.1`)                                                                                      | **Dibuang**                                       | Fitur AI chat bebas diganti assistant menu cepat tanpa LLM (`AGENTS.md §8`).                                            |
| `helmet`, `express-rate-limit`, `pino`, `pino-http`, `pino-pretty`, `luxon`, `vitest`, `supertest`, `eslint`, `prettier` | **Dipertahankan / Dipasang**                      | Fondasi keamanan, logging redaksi, waktu timezone outlet, testing, dan kualitas kode (`AGENTS.md §1`).                  |
| `nodemailer`, `file-type`, `sharp`, `cookie-parser`                                                                      | **Siap untuk Fase 2 / Tidak di-import di Fase 0** | Sudah terpasang dari iterasi sebelumnya; pastikan tidak ada kode fitur/bisnis yang meng-import-nya pada fondasi Fase 0. |
| `.gitignore`                                                                                                             | **Dipertahankan & Dilengkapi**                    | Menyertakan `node_modules`, `.env`, `.env.*`, `storage/`, `/dist`, `.vscode/`, `.idea/`, `.DS_Store`, `Thumbs.db`.      |
| `.env.example` & `README.md`                                                                                             | **Dipertahankan / Diselaraskan**                  | Memastikan dokumentasi dua database (`tallero_dev` & `tallero_test`) tanpa Docker jelas.                                |
| `.agents/`, `.claude/`, `.windsurf/`, `skills-lock.json`                                                                 | **Dibuang (sudah staged delete)**                 | Aset skill generator lama yang tidak diperlukan di repo backend.                                                        |

### B. Database & Migrasi (`prisma/`)

| Item                                                                    | Tindakan                                                   | Alasan                                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_legacy/prisma/schema.prisma`                                          | **Dibuang / Diganti di Fase 1**                            | Menggunakan `Decimal`, `onDelete: Cascade`, `otpCode` plaintext, tanpa soft delete.                                                                   |
| `prisma/migrations/`                                                    | **Dibuang bila ada riwayat lama; dibuat bersih di Fase 1** | Saat ini belum ada subfolder migrasi di `prisma/`; migrasi awal bersih dibuat di Fase 1 pada database baru.                                           |
| `prisma/schema.prisma` & `prisma/seed.js` (draft working tree saat ini) | **Diselaraskan di Fase 1**                                 | `prisma/seed.js` saat ini meng-import `../src/core/prisma.js` yang melanggar struktur baru; harus diarahkan ke `../src/config/prisma.js` pada Fase 1. |

### C. Kode Sumber Lama (`_legacy/src/`) & File Working Tree Saat Ini (`src/`)

| Item                                                                                                                         | Tindakan                                                                            | Alasan                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_legacy/src/**` (controllers, routes, schemas, middlewares, utils, config, app.js)                                          | **Dipertahankan terisolasi di `_legacy/` (dihapus di Fase 11)**                     | Bahan referensi saja; dilarang di-import oleh kode baru (`AGENTS.md §0 & §2`).                                                                                                                                                           |
| File duplikat lama (`chatController.js`, `chatRoutes.js`, `chatSchema.js`, dll.)                                             | **Dibuang (berada di `_legacy/`)**                                                  | Duplikasi penamaan dan konsep AI chat terlarang (`AGENTS.md §10`).                                                                                                                                                                       |
| `src/core/*` (`errors.js`, `response.js`, `pagination.js`, `validate.js`, `prisma.js`, `security/*`) dari iterasi sebelumnya | **Dipindahkan / Diganti ke Struktur Baru di Langkah B & Fase 1**                    | `AGENTS.md §2` melarang folder `core/`. `errors.js`, `response.js`, `pagination.js` dipindah ke `src/utils/`; `validate.js` ke `src/middlewares/`; `prisma.js` ke `src/config/` dan `crypto.js`/`signedUrl.js` ke `src/utils/` (Fase 1). |
| `src/middlewares/error.js` & `src/middlewares/notFound.js`                                                                   | **Digabung menjadi `src/middlewares/errorHandler.js`**                              | Sesuai struktur `AGENTS.md §2` dan spesifikasi Fase 0 (`errorHandler.js` menangani 404 + Zod/Multer/Prisma/JWT/error tak terduga).                                                                                                       |
| `src/routes.js`                                                                                                              | **Diganti menjadi `src/routes/index.js`**                                           | `AGENTS.md §2` menetapkan `src/routes/index.js` sebagai satu-satunya mount point `/api/v1` (dan satu-satunya `index.js` yang diizinkan).                                                                                                 |
| `src/modules/**` (`auth/*`, `files/*`), `src/integrations/**`, `src/jobs/cleanup.js`, `*.mapper.js`, `*.policy.js`           | **Dikeluarkan dari fondasi Fase 0 / Dibangun Ulang sesuai Struktur Baru di Fase 2** | `AGENTS.md §2 & §10` melarang folder `modules/`, `integrations/`, serta file `*.mapper.js`, `*.policy.js`, dan barrel `index.js` selain `routes/index.js`. Fase 0 harus berisi fondasi bersih tanpa fitur bisnis.                        |
| `src/config/env.js`, `src/config/rules.js`, `src/config/logger.js`, `src/app.js`, `src/server.js`                            | **Dipertahankan & Diselaraskan**                                                    | Import diselaraskan ke `src/utils/*`, `src/middlewares/errorHandler.js`, dan `src/routes/index.js`.                                                                                                                                      |
| Skrip `check:structure`                                                                                                      | **Dibuat Baru di Langkah B**                                                        | Wajib memvalidasi aturan penempatan & penamaan `AGENTS.md §2` dan dijalankan bersama `npm run lint`.                                                                                                                                     |
