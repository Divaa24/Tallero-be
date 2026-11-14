# TALLERO AUTO — BACKEND MASTER RULES

> Taruh file ini di root repo sebagai `AGENTS.md` (atau paste ke Rules workspace Antigravity).
> Berlaku untuk SEMUA fase. Jika prompt fase bertentangan dengan file ini, file ini menang.

---

## 0. Peran & misi

Kamu adalah senior backend engineer. Bangun ulang backend bengkel **Tallero Auto**. Repo sudah punya kerangka/kode lama: itu hanya **bahan screening dan referensi ide**, bukan fondasi. Kode lama **jangan di-patch dan jangan di-copy mentah**; kerjakan Fase 0 (screening) lebih dulu sebelum menghapus atau menimpa apa pun.
Konsumen API: **Web Admin (React/Vite)** dan **Mobile (Expo/React Native)**.

Prioritas mutlak: **keamanan > kebenaran logika > kejelasan > jumlah fitur**.
Lebih baik fitur lebih sedikit tapi benar daripada banyak tapi bocor.

---

## 1. Stack (tetap, jangan ganti tanpa alasan tertulis di `docs/DECISIONS.md`)

| Area        | Pilihan                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime     | Node.js LTS (>= 20), **JavaScript ESM** (`"type": "module"`), tanpa TypeScript                                                                         |
| Framework   | Express 5 (async error otomatis diteruskan; **`req.query` read-only**)                                                                                 |
| DB          | **PostgreSQL 16** + Prisma (ikuti dokumentasi versi Prisma yang terpasang; jika Prisma 7, pakai `prisma.config` + driver adapter `@prisma/adapter-pg`) |
| Validasi    | Zod (versi terbaru; pakai `error.issues`, bukan `error.errors`)                                                                                        |
| Auth        | JWT access token (HS256 dipin eksplisit) + refresh token opaque ter-rotasi, `bcrypt` cost 12                                                           |
| Email       | Nodemailer + **Gmail OAuth2** (Google Cloud Console). Driver `console` hanya untuk dev                                                                 |
| Pembayaran  | **Midtrans Snap** (HTTP langsung dengan Basic Auth, tanpa SDK lama)                                                                                    |
| Realtime    | Socket.IO (ter-autentikasi, berbasis room)                                                                                                             |
| Upload      | multer (memory) + `file-type` (cek magic bytes) + `sharp` (re-encode, hapus EXIF)                                                                      |
| PDF / Excel | `pdfkit` / `exceljs`                                                                                                                                   |
| Job         | `node-cron` (timezone `Asia/Jakarta`)                                                                                                                  |
| Push        | `expo-server-sdk` (gagal = tidak boleh menggagalkan request utama)                                                                                     |
| Keamanan    | `helmet`, `cors` (whitelist), `express-rate-limit`, `pino` + `pino-http` (dengan redaksi)                                                              |
| Tes         | `vitest` + `supertest` (database PostgreSQL khusus test)                                                                                               |
| Docs        | OpenAPI dibangkitkan dari skema Zod (`@asteasolutions/zod-to-openapi`) + Swagger UI (non-production)                                                   |

**Tanpa Docker.** PostgreSQL dipasang langsung di mesin dev. Pakai **dua database terpisah** (mis. `tallero_dev` dan `tallero_test`), masing-masing dengan `DATABASE_URL` dan `TEST_DATABASE_URL` di `.env`. Tes tidak boleh menyentuh database dev. Konfigurasi hanya dari `.env`, divalidasi Zod saat boot; **app harus gagal start** bila env wajib hilang atau lemah (mis. `JWT_SECRET` < 32 karakter). **Dilarang fallback secret hardcoded.**

---

## 2. Struktur folder

```
<root backend yang sudah ada>/
├─ prisma/            schema.prisma, migrations/, seed.js
├─ src/
│  ├─ app.js  server.js
│  ├─ config/         env.js, rules.js, logger.js, prisma.js, socket.js
│  ├─ routes/         index.js (satu-satunya tempat mount ke /api/v1), auth.routes.js, bookings.routes.js, ...
│  ├─ controllers/    auth.controller.js, bookings.controller.js, ...
│  ├─ services/       auth.service.js, bookings.service.js, mail.service.js, midtrans.service.js, push.service.js, ...
│  ├─ validations/    auth.validation.js, bookings.validation.js, ...
│  ├─ middlewares/    authenticate.js, authorize.js, validate.js, rateLimit.js, upload.js, errorHandler.js
│  ├─ utils/          errors.js, response.js, pagination.js, crypto.js, signedUrl.js
│  └─ jobs/           scheduler.js, noShow.job.js, reminders.job.js, cleanup.job.js, paymentSync.job.js
├─ storage/private/   # di luar public, di-.gitignore
├─ tests/             unit/, integration/, helpers/
├─ docs/              DECISIONS.md, FLOW.md, API.md
└─ .env.example  README.md
```

Nama fitur (dipakai sebagai awalan file di tiap folder lapisan): `auth`, `users`, `outlets`, `catalog` (kategori + layanan), `spareparts`, `vehicles`, `bookings`, `payments`, `reviews`, `notifications`, `reports`, `assistant`, `files`, `staff`, `audit`.

**Aturan lapisan (satu folder per lapisan, file per fitur di dalamnya):**

- **routes**: daftar endpoint + middleware (`authenticate`, `authorize`, `validate`, rate limit) → controller.
- **controllers**: tipis. Ambil `req.valid`, panggil service, kirim response. Tanpa logika bisnis, tanpa Prisma.
- **services**: seluruh logika bisnis + akses Prisma. Fungsi menerima `actor` (user terautentikasi) secara eksplisit. Integrasi eksternal (email, Midtrans, push Expo) juga ada di sini sebagai `mail.service.js`, `midtrans.service.js`, `push.service.js`.
- **validations**: skema Zod (body/query/params).
- **middlewares**: hanya middleware Express. **utils**: fungsi murni kecil yang dipakai lintas fitur. **config**: env, konstanta bisnis, logger, klien Prisma, inisialisasi Socket.IO.

**Tidak ada file `policy` dan `mapper`.** Gantinya:

- _Akses resource_: kepemilikan di-scope **langsung di query** (`where: { id, customerId: actor.id }`). Tidak ketemu → 404. Ini pertahanan IDOR yang paling sulit terlewat. Untuk staf, fungsi kecil `bookingScope(actor)` di service yang menghasilkan `where`.
- _Bentuk respons_: pakai Prisma `select` yang dideklarasikan sebagai konstanta di atas file service (mis. `customerBookingSelect`, `staffBookingSelect`). Field rahasia **tidak pernah dipilih**, jadi tidak mungkin bocor. Tidak ada record Prisma mentah yang boleh dikirim ke client.

**Aturan penamaan & penempatan:**

- Nama file: `<fitur>.<lapisan>.js` dalam camelCase (`bookings.controller.js`, `auth.validation.js`). Lapisan: `routes`, `controller`, `service`, `validation`, `job`.
- Endpoint admin untuk fitur yang sama tetap di file fitur itu (`outlets.routes.js` mengekspor router publik dan router admin); jangan bikin `adminX.controller.js` terpisah kecuali logikanya memang berbeda.
- Tidak ada subfolder per fitur di dalam folder lapisan (tidak ada `controllers/auth/`). Satu folder lapisan = satu level file.
- Logika besar yang dipecah dari sebuah service boleh jadi file sendiri di `services/` dengan nama spesifik tanpa suffix lapisan: `bookingStateMachine.js`, `slots.js`, `queue.js`.
- **Dilarang** sebagai nama/suffix file: `helper(s)`, `util(s)`, `common`, `manager`, `handler`, `factory`, `base`, `mapper`, `policy`, `dto`, `v2`, `new`, `final`. Dilarang `index.js` pengumpul (barrel); satu-satunya `index.js` yang boleh adalah `routes/index.js`.
- Dilarang folder `modules/`, `core/`, `lib/`, `integrations/`, `realtime/` (sudah dilebur ke struktur di atas).
- Satu file maksimal ± 300 baris; jika lebih, pecah menurut tanggung jawab dengan nama spesifik.
- Script `npm run check:structure` (dibuat di Fase 0) gagal bila: file `*.controller.js`/`*.service.js`/`*.routes.js`/`*.validation.js`/`*.job.js` berada di luar foldernya, ada nama terlarang, ada folder terlarang, atau ada import dari `_legacy/`. Dijalankan bersama `lint`.

---

## 3. Konvensi API

- Prefix `/api/v1`. JSON. Bahasa `message` = **Bahasa Indonesia**; `code` = konstanta Inggris (`BOOKING_NOT_FOUND`).
- Sukses: `{ "success": true, "data": ..., "meta": { page, limit, total, totalPages }? }`
- Gagal: `{ "success": false, "error": { "code", "message", "details"? } }`
- Status code: 400 validasi, 401 belum login/token salah, 403 role tidak boleh, **404 untuk resource milik orang lain** (jangan bocorkan keberadaan), 409 konflik state/stok/slot, 422 aturan bisnis, 429 rate limit.
- Semua list: pagination `page` (default 1) & `limit` (default 20, **maks 100**), sort hanya dari whitelist.
- Validator memakai `req.valid = { body, query, params }`. **Jangan assign ke `req.query`.** Body Zod memakai `.strict()` (field tak dikenal = 400) → anti mass-assignment.
- ID di params: `z.coerce.number().int().positive()`.
- **Uang = integer Rupiah** (`Int`), tidak ada float/Decimal. Midtrans butuh integer.
- **Waktu disimpan UTC**; perhitungan slot/antrian/laporan memakai timezone outlet (`Asia/Jakarta`) via `luxon`.
- **PostgreSQL case-sensitive**: email selalu lowercase sebelum disimpan/dicari; pencarian teks (nama, plat, kode) memakai `mode: "insensitive"`.
- Telepon dinormalisasi ke `+62…`; plat nomor: uppercase, tanpa spasi/strip, regex `^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$`; email: trim + lowercase.
- Error tak terduga: log lengkap (pino), respons client generik (`INTERNAL_ERROR`) tanpa stack trace. Tangani `MulterError`, error Prisma (`P2002`→409, `P2025`→404), `ZodError`, JWT.

---

## 4. Aturan keamanan (NON-NEGOTIABLE)

**Auth & sesi**

1. Access token 15 menit; refresh token opaque 48 byte acak, simpan **hash SHA-256**, rotasi tiap refresh, **deteksi reuse** (token lama dipakai ulang → cabut seluruh family). Logout mencabut token. Ganti/reset password & nonaktifkan user → `tokenVersion++` + cabut semua refresh token.
2. `authenticate` selalu cek DB: user ada, `deletedAt = null`, `isActive`, `isVerified`, `tokenVersion` cocok.
3. Login: pesan error generik, hash dummy saat user tak ada (samakan waktu respons), cek password **sebelum** membocorkan status akun apa pun, lockout 5 gagal → 15 menit.
4. Register publik **hanya** membuat `CUSTOMER`. Staf dibuat Admin (`mustChangePassword = true`). Admin pertama hanya dari seed (env), bukan endpoint publik.
5. Respons register/forgot-password **sama** baik email terdaftar maupun tidak (anti user-enumeration).
6. Web: refresh token boleh via cookie `httpOnly; Secure; SameSite=Strict` (header `X-Client: web`); Mobile: via body (disimpan di SecureStore).

**OTP (hanya untuk register)** 7. 6 digit dari `crypto.randomInt(0, 1_000_000)` di-pad nol; simpan **HMAC-SHA256** (bukan plaintext); TTL 10 menit; maks 5 percobaan lalu hangus; cooldown resend 60 detik; maks 5 kirim/jam; dibandingkan `timingSafeEqual`; sekali pakai. 8. **Lupa password TIDAK memakai OTP**: token reset acak 32 byte, simpan hash, TTL 30 menit, sekali pakai, dikirim sebagai link email.

**Otorisasi** 9. Dua lapis: `authorize(...roles)` di route + scope kepemilikan di query service untuk resource. **Tidak ada endpoint tanpa keputusan otorisasi eksplisit.** 10. Customer hanya melihat/mengubah data miliknya. Resource milik orang lain → **404**. 11. Pembatasan field: customer tidak pernah menerima email/telepon staf; mekanik tidak menerima data sensitif customer yang tidak perlu (lihat §6).

**Data** 12. Respons whitelist lewat Prisma `select`: `passwordHash`, `otpHash`, token, `tokenVersion`, `failedLoginCount`, `googleId`, `rawNotification` **tidak pernah** keluar. Pakai `omit`/`select` Prisma. 13. Harga/total **selalu dihitung server** dari snapshot `BookingItem`. Client tidak boleh mengirim harga, total, status pembayaran, atau tip melewati batas. 14. Query Prisma tanpa `$queryRawUnsafe`. Raw query hanya `$queryRaw` ber-parameter. 15. Soft delete (§5) dan `onDelete: Restrict` untuk semua relasi tabel transaksi. 16. Operasi multi-langkah wajib `prisma.$transaction`. Perubahan status memakai **update bersyarat** (`updateMany where {id, status: from}` dan cek `count === 1`) agar aman dari race. 17. Event realtime/notifikasi/email dikirim **setelah commit**, dan kegagalannya tidak boleh me-rollback bisnis.

**File** 18. Foto disimpan di `storage/private/` (bukan folder publik). Nama file = UUID (nama asli tidak dipakai). Validasi magic bytes, maks 5 MB, re-encode ke WebP via `sharp` (hapus EXIF/GPS), maks sisi 1920 px. 19. Akses file lewat **signed URL berumur pendek** (`exp` + HMAC) yang hanya dibuat setelah pengecekan akses lolos. Handler file memverifikasi `sig` & `exp` dengan `timingSafeEqual`, mencegah path traversal.

**Infrastruktur** 20. `helmet`, CORS whitelist dari env (izinkan request tanpa `Origin` untuk mobile native), body limit 100 KB (kecuali upload), rate limit global + ketat untuk auth/OTP/forgot/availability, `trust proxy` dari env. 21. Log `pino` dengan redaksi `authorization`, `password`, `token`, `otp`, `cookie`. Tidak ada `console.log`. 22. Webhook Midtrans: verifikasi `signature_key` (SHA-512 dari `order_id + status_code + gross_amount + ServerKey`, `timingSafeEqual`) **dan** konfirmasi ulang lewat Status API, cocokkan `gross_amount` dengan DB, idempotent. 23. Socket.IO: autentikasi JWT saat handshake, room per-user/per-outlet, **tidak ada broadcast global**, payload minimal, event dari client diabaikan/dibatasi. 24. Export CSV/Excel: netralkan formula injection (sel diawali `= + - @` diberi prefiks `'`).

---

## 5. Soft delete

- Model: `User, Outlet, Category, Service, Sparepart, Vehicle` punya `deletedAt DateTime?`. Tabel transaksi (Booking, Payment, Log, Review, dll.) **tidak pernah dihapus**.
- Implementasi: Prisma client extension yang otomatis menambah `deletedAt: null` pada `findMany/findFirst/findFirstOrThrow/findUnique/count/aggregate/groupBy`, mengubah `delete/deleteMany` jadi `update deletedAt = now()`, dan menyediakan helper eksplisit `withDeleted` untuk admin/restore. **Tulis tes** yang membuktikan filter ini bekerja.
- Include relasi di riwayat booking tetap menampilkan data lama lewat **snapshot** (`nameSnapshot`, `unitPrice`), bukan relasi aktif.
- Hapus ditolak (409) bila masih ada booking aktif (status bukan `COMPLETED/CANCELLED/NO_SHOW`) yang bergantung pada entitas itu.
- Unik + soft delete: Prisma tidak bisa mendeklarasikan partial index, jadi pakai kolom `Vehicle.activePlate` (= plat saat aktif, `NULL` saat dihapus, `@unique`; PostgreSQL memperlakukan tiap `NULL` sebagai berbeda). `User.email` tetap unik permanen (restore oleh admin).
- Admin tidak boleh menghapus/menonaktifkan/menurunkan role **dirinya sendiri** atau **admin aktif terakhir**.

---

## 6. Role & hak akses

| Role       | Cakupan                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CUSTOMER` | Data miliknya saja: profil, kendaraan, booking, pembayaran, notifikasi, review                                                                                                                                                                  |
| `MECHANIC` | Terikat satu outlet (`User.outletId` wajib). Boleh melihat **antrian outlet-nya** (data customer dibatasi: nama depan + kendaraan; telepon lengkap hanya pada booking yang di-assign ke dirinya). Aksi tulis hanya pada booking yang ia tangani |
| `ADMIN`    | Global semua outlet: lihat semua, assign mekanik, kasir (cash), complete, master data, laporan, user                                                                                                                                            |

Pada booking: customer melihat nama mekanik + rating-nya, **bukan** email/telepon mekanik.

---

## 7. Model domain (ringkas — jadi acuan schema Prisma)

Enum: `Role(ADMIN,MECHANIC,CUSTOMER)`, `VehicleType(CAR,MOTORCYCLE)`,
`BookingStatus(PENDING,CHECKED_IN,IN_PROGRESS,WAITING_APPROVAL,READY_FOR_PICKUP,COMPLETED,CANCELLED,NO_SHOW)`,
`ItemType(SERVICE,SPAREPART)`, `ItemSource(CUSTOMER_BOOKING,MECHANIC_ADDED)`, `ApprovalStatus(APPROVED,PENDING_APPROVAL,REJECTED)`,
`PhotoType(BEFORE,AFTER)`, `PaymentType(INVOICE,TIP)`, `PaymentMethod(CASH,MIDTRANS)`,
`PaymentStatus(PENDING,PAID,FAILED,EXPIRED,CANCELLED,REFUNDED,DUPLICATE)`, `BookingPaymentStatus(UNPAID,PAID)`,
`NotificationType(BOOKING_STATUS,APPROVAL_REQUEST,PAYMENT,SERVICE_REMINDER,SYSTEM)`, `ReminderStatus(SCHEDULED,REMINDED,DUE,DONE,CANCELLED)`.

| Model                  | Field kunci                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                 | name, email(unique), passwordHash, phone, address?, avatarKey?, role, outletId?, isActive, isVerified, mustChangePassword, tokenVersion, failedLoginCount, lockedUntil?, googleId?(unique), lastLoginAt?, deletedAt?                                                                                                                                             |
| `RegistrationOtp`      | userId, codeHash, expiresAt, attempts, consumedAt?, createdAt                                                                                                                                                                                                                                                                                                    |
| `PasswordResetToken`   | userId, tokenHash(unique), expiresAt, usedAt?                                                                                                                                                                                                                                                                                                                    |
| `RefreshToken`         | userId, tokenHash(unique), familyId, expiresAt, revokedAt?, replacedById?, userAgent?, ip?                                                                                                                                                                                                                                                                       |
| `DeviceToken`          | userId, expoPushToken(unique), platform, lastSeenAt                                                                                                                                                                                                                                                                                                              |
| `Outlet`               | name, address, phone?, latitude, longitude, openDays(Json ISO 1–7), openTime "HH:mm", closeTime, slotMinutes, slotCapacity, timezone, isActive, deletedAt?                                                                                                                                                                                                       |
| `OutletClosure`        | outletId, date(`@db.Date`), reason · unique(outletId,date)                                                                                                                                                                                                                                                                                                       |
| `Category` / `Service` | Service: categoryId, name, description?, price Int, estimatedMinutes, vehicleType? (null = semua), reminderIntervalDays?, reminderIntervalKm?, isActive, deletedAt?                                                                                                                                                                                              |
| `Sparepart`            | sku(unique), name, price Int, stock Int, unit, isActive, deletedAt?                                                                                                                                                                                                                                                                                              |
| `Vehicle`              | userId, plateNumber, activePlate?(unique), brand, model, type, year, color?, lastOdometerKm?, deletedAt?                                                                                                                                                                                                                                                         |
| `Booking`              | code(unique), customerId, outletId, vehicleId, mechanicId?, scheduledAt, slotEndAt, status, queueDate?, queueNumber?, isLate, checkedInAt?, startedAt?, readyAt?, completedAt?, cancelledAt?, cancelledById?, cancelReason?, odometerKm?, customerNotes?, staffNotes?, total Int, paymentStatus, invoiceNumber?(unique) · unique(outletId,queueDate,queueNumber) |
| `BookingItem`          | bookingId, type, serviceId?, sparepartId?, nameSnapshot, unitPrice, quantity, subtotal, source, approvalStatus, requestedById, decidedById?, decidedAt?, rejectReason?, stockDeducted, note?                                                                                                                                                                     |
| `BookingPhoto`         | bookingId, type, storageKey, mimeType, sizeBytes, caption?, uploadedById, deletedAt?                                                                                                                                                                                                                                                                             |
| `BookingLog`           | bookingId, actorId?, actorRole?(SYSTEM utk cron), fromStatus?, toStatus, note?, createdAt                                                                                                                                                                                                                                                                        |
| `Payment`              | bookingId, type(INVOICE/TIP), method, orderId(unique), amount Int, status, snapToken?, redirectUrl?, midtransTransactionId?, midtransPaymentType?, expiresAt?, paidAt?, receivedById?(cash), recipientMechanicId?(tip), rawNotification Json?                                                                                                                    |
| `Review`               | bookingId(unique), customerId, mechanicId?, outletId, rating 1–5, comment?, isHidden                                                                                                                                                                                                                                                                             |
| `Notification`         | userId, type, title, body, data Json?, readAt?                                                                                                                                                                                                                                                                                                                   |
| `ServiceReminder`      | vehicleId, userId, serviceId, sourceBookingId, dueDate, dueOdometerKm?, status, remindedAt?, dueNotifiedAt?                                                                                                                                                                                                                                                      |
| `AuditLog`             | actorId?, action, entity, entityId, before Json?, after Json?, ip?, createdAt                                                                                                                                                                                                                                                                                    |

Wajib ada index untuk: `Booking(outletId,status,queueDate,queueNumber)`, `Booking(customerId,status)`, `Booking(scheduledAt)`, `Payment(bookingId)`, `Notification(userId,readAt)`, `ServiceReminder(status,dueDate)`.

---

## 8. Aturan bisnis & State Machine

**Konstanta** semuanya di `src/config/rules.js` (satu sumber kebenaran):
`MIN_LEAD_MINUTES=60`, `MAX_ADVANCE_DAYS=30`, `CANCEL_CUTOFF_MINUTES=60`, `CHECKIN_EARLY_MINUTES=60`, `NO_SHOW_GRACE_MINUTES=60`,
`MAX_ACTIVE_BOOKINGS_PER_CUSTOMER=3`, `MAX_ACTIVE_JOBS_PER_MECHANIC=1`, `MAX_PHOTOS_PER_TYPE=10`,
`TIP_MIN=1000`, `TIP_MAX_PER_TRANSACTION=500000`, `TIP_WINDOW_DAYS=7`, `REVIEW_WINDOW_DAYS=30`,
`OTP_TTL_MIN=10`, `OTP_MAX_ATTEMPTS=5`, `OTP_RESEND_COOLDOWN_SEC=60`, `OTP_MAX_SENDS_PER_HOUR=5`,
`LOGIN_MAX_FAILS=5`, `LOCK_MINUTES=15`, `ACCESS_TTL=15m`, `REFRESH_TTL_DAYS=30`, `SIGNED_URL_TTL_SEC=600`,
`PAYMENT_EXPIRY_MIN=60`, `REMINDER_LEAD_DAYS=7`, `REPORT_MAX_RANGE_DAYS=366`.

**Satu pintu perubahan status**: `bookingStateMachine.transition(tx, bookingId, toStatus, actor, opts)` — memuat booking, cek akses, cek transisi legal, cek guard, update bersyarat, tulis `BookingLog`, kembalikan event untuk di-emit setelah commit. **Dilarang meng-update `status` di tempat lain.**

| Dari → Ke                                  | Siapa                                             | Guard                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING → CHECKED_IN`                     | ADMIN / MECHANIC outlet sama                      | QR valid (HMAC), hari-H, mulai `scheduledAt − CHECKIN_EARLY`, sebelum jam tutup. Set `queueDate`, `queueNumber` (atomik di bawah lock baris outlet), `checkedInAt`, `isLate` |
| `PENDING → CANCELLED`                      | CUSTOMER (pemilik) / ADMIN                        | Customer: sebelum `scheduledAt − CANCEL_CUTOFF`. Wajib alasan bila ADMIN                                                                                                     |
| `PENDING → NO_SHOW`                        | SYSTEM (cron)                                     | `now > slotEndAt + NO_SHOW_GRACE`                                                                                                                                            |
| `CHECKED_IN → IN_PROGRESS`                 | MECHANIC / ADMIN-assign lalu mekanik start        | Booking harus **kepala antrian** untuk mekanik itu; mekanik belum penuh (`MAX_ACTIVE_JOBS`); stok semua item APPROVED cukup lalu dipotong; set `mechanicId`, `startedAt`     |
| `CHECKED_IN → CANCELLED`                   | ADMIN                                             | Alasan wajib                                                                                                                                                                 |
| `IN_PROGRESS → WAITING_APPROVAL`           | mekanik penangan / ADMIN                          | Ada ≥ 1 item `PENDING_APPROVAL` (dibuat via endpoint item)                                                                                                                   |
| `WAITING_APPROVAL → IN_PROGRESS`           | otomatis saat semua item pending sudah diputuskan | Stok item yang disetujui dipotong bersyarat                                                                                                                                  |
| `IN_PROGRESS → READY_FOR_PICKUP`           | mekanik penangan / ADMIN                          | ≥ 1 foto BEFORE & ≥ 1 AFTER, tak ada item pending, `total` dihitung ulang; set `readyAt`                                                                                     |
| `IN_PROGRESS/WAITING_APPROVAL → CANCELLED` | ADMIN                                             | Alasan wajib, stok yang sudah dipotong dikembalikan, tercatat di audit                                                                                                       |
| `READY_FOR_PICKUP → COMPLETED`             | ADMIN                                             | Invoice `PAID`. Set `completedAt`, `invoiceNumber`, buat `ServiceReminder`                                                                                                   |

Status lain **ilegal** (mis. `COMPLETED → PENDING`) → 409 `INVALID_TRANSITION`.

**Slot & kapasitas**

- Slot = grid dari `openTime` s/d `closeTime` per `slotMinutes`. Slot valid bila: hari buka, bukan `OutletClosure`, `start ≥ now + MIN_LEAD`, `start ≤ now + MAX_ADVANCE`.
- Terisi = jumlah booking slot itu yang statusnya bukan `CANCELLED/NO_SHOW`. Status slot: `AVAILABLE`, `LIMITED` (sisa 1), `FULL`, `CLOSED`, `PAST`.
- Cegah overbooking: di dalam transaksi, kunci baris outlet `SELECT id FROM outlets WHERE id = ${id} FOR UPDATE` (tagged template `$queryRaw`, otomatis ber-parameter), hitung ulang, baru insert.
- Satu kendaraan hanya boleh punya **1 booking aktif**; satu customer maks `MAX_ACTIVE_BOOKINGS_PER_CUSTOMER`.
- Layanan harus cocok `vehicleType` kendaraan; outlet & layanan harus aktif.

**Antrian (anti-menyelak)**

- `queueNumber` per outlet per hari lokal, naik berurutan saat check-in. Urutan antrian = `queueNumber` ASC.
- "Kepala antrian" untuk mekanik M = `CHECKED_IN` dengan `queueNumber` terkecil di antara booking yang `mechanicId IS NULL` atau `= M`. Mekanik hanya boleh memulai booking tersebut (selain itu → 409 `QUEUE_ORDER_VIOLATION` + info kepala antrian).
- Proses start berada dalam transaksi dengan lock outlet agar dua mekanik tidak mengambil booking yang sama.
- Estimasi tunggu = Σ `estimatedMinutes` booking di depan ÷ jumlah mekanik aktif outlet (pembulatan ke atas, dilabeli "perkiraan").

**Item, persetujuan, harga**

- `BookingItem` menyimpan snapshot nama & harga saat dibuat. `total = Σ subtotal item APPROVED`, dihitung ulang di transaksi tiap item berubah.
- Item dari customer saat booking → `APPROVED`. Item tambahan mekanik → `PENDING_APPROVAL` + status `WAITING_APPROVAL` + notifikasi `APPROVAL_REQUEST`.
- Customer memutuskan secara batch (approve/reject per item, alasan opsional saat reject). ADMIN dapat memutuskan atas nama customer **dengan catatan wajib** (dicatat audit) untuk kasus konfirmasi via telepon.
- Item ditolak tetap tersimpan, tidak ditagih. Stok hanya dipotong saat item APPROVED **dan** booking sudah/sedang `IN_PROGRESS`; dikembalikan bila dibatalkan.

**Pembayaran (Midtrans Snap)**

- Invoice hanya dibuat saat `READY_FOR_PICKUP` dan `paymentStatus = UNPAID`. Nominal = `booking.total` (server). `order_id = {bookingCode}-INV-{n}` / `-TIP-{n}` (≤ 50 karakter).
- Satu booking boleh banyak percobaan, tapi hanya satu yang boleh `PAID`. Bila ada yang kedua settle → tandai `DUPLICATE` + `AuditLog` + notifikasi admin (refund manual).
- Pembuatan percobaan baru membatalkan percobaan `PENDING` sebelumnya via Midtrans cancel API.
- Tip = `Payment` terpisah (`type=TIP`) → **bukan pendapatan bengkel**, milik `recipientMechanicId`. Boleh saat `READY_FOR_PICKUP`/`COMPLETED` dalam `TIP_WINDOW_DAYS`, hanya jika `mechanicId` ada, dan dibatasi `TIP_MIN..TIP_MAX`.
- Cash: ADMIN mencatat (`receivedById`); membatalkan percobaan Midtrans yang pending.
- Webhook: signature → status API → cek amount → transaksi DB → idempotent (event ganda tidak mengubah apa-apa).

**Review**: hanya pemilik, status `COMPLETED`, dalam `REVIEW_WINDOW_DAYS`, sekali per booking. Menyimpan `mechanicId` & `outletId` dari booking. Review publik anonim (nama depan saja).

**Reminder servis**: saat `COMPLETED`, tiap item SERVICE yang punya `reminderIntervalDays/Km` → buat `ServiceReminder` (due = `completedAt + interval`); reminder lama kendaraan+layanan yang sama → `DONE`. Cron harian 08:00 WIB: `SCHEDULED → REMINDED` (H−`REMINDER_LEAD_DAYS`, notifikasi) → `DUE` (hari-H, notifikasi). Reminder berbasis KM dievaluasi saat odometer diperbarui.

**Assistant tanpa AI (menu cepat)**: tidak ada LLM, tidak ada input teks bebas. Customer memilih intent dari menu → respons terstruktur (`type`, `title`, `message`, `options[]`). Intent: `CHECK_SLOT`, `OUTLET_OPEN_STATUS`, `MY_BOOKING_STATUS` (+ posisi antrian & estimasi), `SERVICE_PRICE_LIST`, `MY_NEXT_SERVICE`.

---

## 9. Daftar endpoint (prefix `/api/v1`)

Akses: **P** publik · **C** customer · **M** mekanik · **A** admin · **S** = M+A.

**Auth**

| Method    | Path                                | Akses | Catatan                                               |
| --------- | ----------------------------------- | ----- | ----------------------------------------------------- |
| POST      | `/auth/register`                    | P     | buat CUSTOMER unverified + kirim OTP; respons generik |
| POST      | `/auth/verify-otp`                  | P     | verifikasi → langsung login (access+refresh)          |
| POST      | `/auth/resend-otp`                  | P     | cooldown & kuota                                      |
| POST      | `/auth/login`                       | P     | lockout, flag `mustChangePassword`                    |
| POST      | `/auth/refresh`                     | P     | rotasi + reuse detection                              |
| POST      | `/auth/logout` · `/auth/logout-all` | login | cabut refresh token                                   |
| POST      | `/auth/forgot-password`             | P     | respons generik, link token                           |
| POST      | `/auth/reset-password`              | P     | token sekali pakai                                    |
| POST      | `/auth/change-password`             | login | verifikasi password lama; cabut sesi lain             |
| GET/PATCH | `/auth/me`                          | login | PATCH: name, phone, address saja                      |
| POST      | `/auth/me/avatar`                   | login | upload gambar aman                                    |

**Master data**

| Method                                           | Path                                                                                                                 | Akses                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET                                              | `/outlets` · `/outlets/:id`                                                                                          | P (aktif saja)                                                                |
| GET                                              | `/outlets/:id/availability?date&serviceIds`                                                                          | login                                                                         |
| GET                                              | `/outlets/:id/reviews`                                                                                               | P                                                                             |
| POST/PATCH/DELETE                                | `/admin/outlets` (+`/:id`), `/admin/outlets/:id/closures` (POST, DELETE `/:closureId`), `/admin/outlets/:id/restore` | A                                                                             |
| GET                                              | `/services?categoryId&vehicleType` · `/services/:id` · `/categories`                                                 | P (aktif)                                                                     |
| CRUD                                             | `/admin/categories`, `/admin/services` (+restore)                                                                    | A                                                                             |
| GET                                              | `/spareparts`                                                                                                        | login (customer: nama, harga, `inStock` boolean tanpa jumlah; S: dengan stok) |
| CRUD + `POST /admin/spareparts/:id/adjust-stock` | `/admin/spareparts`                                                                                                  | A (adjust wajib alasan, diaudit)                                              |
| GET                                              | `/admin/users`, `/admin/users/:id`                                                                                   | A                                                                             |
| POST/PATCH/DELETE                                | `/admin/users` (buat staf), `/admin/users/:id`, `/admin/users/:id/status`, `/admin/users/:id/restore`                | A                                                                             |

**Kendaraan**

| Method           | Path                      | Akses                                                   |
| ---------------- | ------------------------- | ------------------------------------------------------- |
| GET/POST         | `/vehicles`               | C (milik sendiri)                                       |
| GET/PATCH/DELETE | `/vehicles/:id`           | C pemilik (DELETE soft, ditolak jika ada booking aktif) |
| GET              | `/vehicles/:id/history`   | C pemilik, S (read-only)                                |
| GET              | `/vehicles/:id/reminders` | C pemilik                                               |

**Booking**

| Method | Path                            | Akses                                                             | Catatan                                                      |
| ------ | ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| POST   | `/bookings`                     | C                                                                 | `{outletId, vehicleId, scheduledAt, items:[{type, serviceId? | sparepartId?, quantity}], customerNotes?}` |
| GET    | `/bookings`                     | C (milik sendiri) / A (semua) / M (outlet sendiri, data dibatasi) | filter status, tanggal, outlet, search                       |
| GET    | `/bookings/:id`                 | pemilik / S sesuai scope                                          |                                                              |
| GET    | `/bookings/:id/logs`            | pemilik / S                                                       |                                                              |
| GET    | `/bookings/:id/qr`              | C pemilik                                                         | payload `code.hmac` (QR digambar oleh FE)                    |
| GET    | `/bookings/:id/queue-position`  | C pemilik                                                         | orang di depan + estimasi                                    |
| POST   | `/bookings/:id/cancel`          | C pemilik / A                                                     | `{reason}`                                                   |
| POST   | `/bookings/check-in`            | S                                                                 | `{qrPayload, odometerKm?}`                                   |
| POST   | `/bookings/:id/assign`          | A                                                                 | `{mechanicId}` (mekanik outlet yang sama)                    |
| POST   | `/bookings/:id/start`           | S                                                                 | patuhi aturan kepala antrian                                 |
| POST   | `/staff/queue/claim-next`       | M                                                                 | pilih kepala antrian lalu start                              |
| PATCH  | `/bookings/:id/inspection`      | penangan / A                                                      | `{odometerKm?, staffNotes?}`                                 |
| POST   | `/bookings/:id/items`           | penangan / A                                                      | item tambahan → WAITING_APPROVAL                             |
| DELETE | `/bookings/:id/items/:itemId`   | penangan / A                                                      | hanya item PENDING_APPROVAL                                  |
| POST   | `/bookings/:id/approvals`       | C pemilik / A (atas nama, catatan wajib)                          | `{decisions:[{itemId, decision, reason?}]}`                  |
| POST   | `/bookings/:id/photos`          | penangan / A                                                      | multipart `photo`, `type`, `caption?`                        |
| GET    | `/bookings/:id/photos`          | pemilik / S                                                       | berisi signed URL                                            |
| DELETE | `/bookings/:id/photos/:photoId` | uploader / A                                                      | soft                                                         |
| GET    | `/files/:kind/:id?exp&sig`      | signed                                                            | stream file                                                  |
| POST   | `/bookings/:id/ready`           | penangan / A                                                      |                                                              |
| POST   | `/bookings/:id/complete`        | A                                                                 |                                                              |
| POST   | `/bookings/:id/review`          | C pemilik                                                         |                                                              |

**Pembayaran**

| Method | Path                              | Akses                                                          |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| POST   | `/bookings/:id/payments/midtrans` | C pemilik / A → `{snapToken, redirectUrl, orderId, expiresAt}` |
| POST   | `/bookings/:id/payments/cash`     | A                                                              |
| POST   | `/bookings/:id/tips`              | C pemilik `{amount}` → Snap                                    |
| GET    | `/bookings/:id/payments`          | pemilik / A                                                    |
| POST   | `/payments/:orderId/sync`         | pemilik / A (tarik status dari Midtrans)                       |
| POST   | `/payments/midtrans/notification` | P (webhook; verifikasi signature, tanpa JWT)                   |
| GET    | `/bookings/:id/invoice.pdf`       | pemilik / A (hanya jika PAID)                                  |

**Dashboard, laporan, notifikasi, lainnya**

| Method      | Path                                                                            | Akses                         |
| ----------- | ------------------------------------------------------------------------------- | ----------------------------- |
| GET         | `/staff/queue?outletId?`                                                        | S (M otomatis outlet sendiri) |
| GET         | `/staff/me/jobs` · `/staff/me/tips` · `/staff/me/reviews`                       | M                             |
| GET         | `/admin/dashboard`                                                              | A                             |
| GET         | `/admin/reports/summary` · `/admin/reports/export?type&format&from&to&outletId` | A                             |
| PATCH       | `/admin/reviews/:id/visibility`                                                 | A                             |
| GET         | `/admin/audit-logs`                                                             | A                             |
| GET         | `/notifications` · `/notifications/unread-count`                                | login                         |
| PATCH       | `/notifications/:id/read` · POST `/notifications/read-all`                      | login                         |
| POST/DELETE | `/notifications/devices`                                                        | login (token Expo)            |
| GET         | `/assistant/menu` · POST `/assistant/query`                                     | C                             |
| GET         | `/health` · `/ready`                                                            | P (tanpa data sensitif)       |

**Socket.IO** (server → client): `booking:status_changed`, `booking:approval_requested`, `queue:updated`, `payment:updated`, `notification:new`. Room: `user:{id}`, `outlet:{id}:staff`, `admin`.

---

## 10. Standar kualitas kode (anti "AI slop")

Dilarang keras:

- Komentar proses berpikir ("Wait…", "Let me…"), `TODO`/`FIXME` yang dibiarkan, kode yang dikomentari, `console.log`.
- File duplikat/varian (`chatController.js` + `chat.controller.js`), import tak terpakai, fungsi tak terpanggil.
- Nilai fallback untuk secret, data dummy, "mock success", `catch` yang menelan error diam-diam.
- Logika bisnis di controller, query Prisma di route, konstanta ajaib tersebar.
- File `*.mapper.js`, `*.policy.js`, `helpers`, barrel `index.js` (selain `routes/index.js`), atau folder bersarang yang hanya berisi satu file.
- Abstraksi berlebihan (repository/factory/DI yang tidak perlu). Gunakan fungsi sederhana.
- Menyebut fitur "sudah ada" padahal tidak diuji.

Wajib:

- Nama konsisten (`camelCase` kode, `snake_case` kolom lewat `@map`, tabel jamak lewat `@@map`).
- Komentar hanya menjelaskan **mengapa**, bukan **apa**.
- ESLint + Prettier lulus tanpa warning. `npm run lint`, `npm test`, `npx prisma validate` hijau.
- Setiap service function punya tes untuk jalur sukses **dan** jalur ditolak (otorisasi, state ilegal, race).

---

## 11. Protokol kerja agent

0. **Larangan operasi destruktif**: jangan pernah menjalankan `prisma migrate reset`, `db push --force-reset`, `DROP DATABASE/TABLE`, `TRUNCATE`, `rm -rf` pada folder di luar `node_modules`/`dist`, atau `git reset --hard`/`git clean -fd` **tanpa persetujuan eksplisit user di chat**. Migrasi hanya ke database baru yang dibuat khusus untuk versi ini (`tallero_dev`), bukan database lama.

1. Baca file ini + prompt fase. **Tulis rencana singkat** (file yang dibuat/diubah, risiko) sebelum coding.
2. Kerjakan **hanya fase yang diminta**. Jangan mengerjakan fase berikutnya, jangan refactor di luar lingkup.
3. Bila ada ambiguitas yang memengaruhi keamanan/alur: pilih opsi paling aman, catat di `docs/DECISIONS.md` (konteks → keputusan → alasan), lanjutkan.
4. Setelah selesai: jalankan lint, test, validasi prisma, dan jalankan **self-audit** terhadap Definition of Done fase itu.
5. Laporan akhir (wajib, ringkas): daftar file baru/diubah · endpoint yang ditambah · cara menjalankan tes · hasil tes · asumsi/keputusan · hal yang belum dikerjakan (harus kosong untuk lingkup fase).
6. **Berhenti** setelah laporan. Jangan lanjut ke fase berikutnya.
