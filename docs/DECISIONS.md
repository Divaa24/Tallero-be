# ARSITEKTUR & KEPUTUSAN TEKNIS (DECISIONS) â€” TALLERO AUTO BACKEND

Dokumen ini mencatat keputusan arsitektural (Architecture Decision Records) untuk backend bengkel Tallero Auto.

---

## ADR-001: Isolasi Kode Lama ke `_legacy/` dan Clean Foundation

- **Tanggal:** 2026-11-07
- **Konteks:** Codebase lama memiliki kerentanan keamanan (secret hardcoded fallback di git history `e26b789`, plaintext OTP, user enumeration, CORS & Socket.IO terbuka global, upload publik tanpa sanitasi, cascade delete pada transaksi, serta dependensi tak terpakai seperti Gemini AI dan Resend).
- **Keputusan:**
  1. Seluruh kode sumber lama (`src/`, `prisma/schema.prisma`) diisolasi di direktori `_legacy/` hingga Fase 11.
  2. Direktori `_legacy/` dikecualikan dari ESLint, Prettier, Vitest, dan dilarang keras di-import oleh kode baru (divalidasi otomatis oleh `npm run check:structure`).
  3. Membangun ulang fondasi dengan struktur datar per lapisan sesuai `AGENTS.md Â§2` (`config/`, `routes/`, `controllers/`, `services/`, `validations/`, `middlewares/`, `utils/`, `jobs/`).

---

## ADR-002: Standarisasi JavaScript ESM, Express 5, dan Lapisan Datar

- **Tanggal:** 2026-11-12
- **Konteks:** Memastikan konsistensi arsitektur tanpa folder bersarang per fitur maupun file `policy`/`mapper`/barrel yang berisiko memicu duplikasi.
- **Keputusan:**
  1. Menggunakan JavaScript ESM native (`"type": "module"`).
  2. Menggunakan Express 5 dengan penyimpanan hasil parsing Zod pada `req.valid = { body, query, params }` tanpa menimpa `req.query` yang bersifat read-only.
  3. Memisahkan `src/app.js` (factory Express) dan `src/server.js` (HTTP server & graceful shutdown `SIGTERM`/`SIGINT`).
  4. Menjadikan `src/routes/index.js` sebagai satu-satunya mount point `/api/v1` dan memusatkan error 404 + error mapping di `src/middlewares/errorHandler.js`.

---

## ADR-003: Validasi Environment Zod & Larangan Fallback Secret

- **Tanggal:** 2026-11-12
- **Konteks:** Menghindari celah keamanan berupa fallback secret hardcoded atau variabel konfigurasi yang hilang saat runtime.
- **Keputusan:**
  1. `src/config/env.js` memvalidasi seluruh environment variables wajib saat boot menggunakan Zod.
  2. Aplikasi wajib gagal start (`process.exit(1)`) jika variabel wajib hilang, terlalu lemah (`JWT_SECRET`/`SIGNED_URL_SECRET`/`OTP_HMAC_SECRET` < 32 karakter), `EMAIL_DRIVER='console'` di `production`, atau `TEST_DATABASE_URL` kosong di mode `test`.
  3. Tidak ada fallback secret atau key hardcoded di kode sumber.

---

## ADR-004: Centralized Logging & Redaksi Data Sensitif (Pino)

- **Tanggal:** 2026-11-07
- **Konteks:** Mencegah kebocoran data sensitif (password, token, OTP, cookie) pada file log atau stdout.
- **Keputusan:**
  1. Menggunakan `pino` dan `pino-http` tanpa `console.log` dalam logika aplikasi.
  2. Mengaktifkan redaksi otomatis (`[REDACTED]`) untuk semua field sensitif sesuai `AGENTS.md Â§4.21`.
  3. Error tak terduga mengembalikan respons generik `INTERNAL_ERROR` (500) tanpa stack trace ke client.

---

## ADR-005: Implementasi Soft Delete, `withDeleted`, dan Global Omit di `src/config/prisma.js`

- **Tanggal:** 2026-11-12
- **Konteks:** `AGENTS.md Â§5` mewajibkan filter otomatis `deletedAt: null` untuk entitas soft-delete, konversi `delete/deleteMany` menjadi `update` (termasuk pengosongan `Vehicle.activePlate`), dan helper `withDeleted` untuk admin/restore, sambil tetap melindungi `User.passwordHash`.
- **Keputusan:**
  1. `basePrisma` dikonfigurasi dengan global `omit: { user: { passwordHash: true } }` sehingga field hash password tidak pernah terbaca kecuali diminta eksplisit di modul auth (`omit: { passwordHash: false }`).
  2. `prisma` adalah turunan `$extends` dari `basePrisma` yang menyisipkan `deletedAt: null` untuk query baca/hitung/update dan mengonversi `delete/deleteMany` menjadi `update/updateMany` di dalam konteks transaksi aktif (`AsyncLocalStorage` `txStorage` + pembungkus `$transaction`).
  3. `withDeleted` diekspor sebagai client eksplisit (`basePrisma`) tanpa filter soft-delete namun tetap berbagi pool koneksi dan tetap menerapkan global `omit` `passwordHash`.
  4. `BookingPhoto` juga disertakan dalam `SOFT_DELETE_MODELS` karena skema `AGENTS.md Â§7` menetapkan `deletedAt` pada model tersebut.

---

## ADR-006: Kebijakan Relasi `onDelete` dan Tipe Data Skema Prisma

- **Tanggal:** 2026-11-12
- **Konteks:** Menjaga integritas historis transaksi sekaligus menjaga kebersihan agregat ephemeral.
- **Keputusan:**
  1. Seluruh tabel master dan transaksi (`User`, `Outlet`, `Category`, `Service`, `Sparepart`, `Vehicle`, `Booking`, `BookingItem`, `BookingPhoto`, `BookingLog`, `Payment`, `Review`, `Notification`, `ServiceReminder`, `AuditLog`) menggunakan `onDelete: Restrict`.
  2. `onDelete: Cascade` hanya diterapkan pada tabel anak-agregat non-transaksional yang aman: `RegistrationOtp`, `PasswordResetToken`, `RefreshToken`, `DeviceToken`, dan `OutletClosure` (termasuk `SetNull` pada `RefreshToken.replacedBy`).
  3. Seluruh nilai uang menggunakan `Int` (Rupiah bulat); koordinat geografis menggunakan `Float`; tanggal kalender murni (`OutletClosure.date`, `Booking.queueDate`) menggunakan `@db.Date`; `BookingLog.actorRole` menggunakan `String?` agar dapat menampung `"SYSTEM"` untuk cron job selain role enum `Role`.

---

## ADR-007: Penempatan Token Sesi & Avatar Storage di Layer Flat Architecture

- **Tanggal:** 2026-11-12
- **Konteks:** `AGENTS.md Â§2` membatasi ukuran tiap file maksimal Â±300 baris dan membolehkan pemecahan logika besar service ke file spesifik dalam `src/services/` tanpa suffix terlarang.
- **Keputusan:**
  1. Logika rotasi refresh token, reuse detection, dan pencabutan sesi dipecah ke `src/services/sessionTokens.js`, sedangkan pemrosesan WebP `sharp` & resolusi signed URL berada di `src/services/files.service.js`, sehingga `src/services/auth.service.js` tetap ringkas dan terfokus.
  2. Avatar disimpan dengan kunci UUID tanpa ekstensi di `User.avatarKey` dan berkas fisiknya ditulis sebagai `storage/private/avatars/<uuid>.webp`, sejalan dengan validasi segment `signedUrl.js` dan penghapusan EXIF otomatis oleh `sharp`.

---

## ADR-008: Kebijakan Lockout Login & Penghapusan OTP Gagal Kirim

- **Tanggal:** 2026-11-12
- **Konteks:** Pada `POST /auth/register` dan `POST /auth/resend-otp`, pengiriman email bisa gagal (502 `EMAIL_DELIVERY_FAILED`), sementara pada `POST /auth/login` dibutuhkan perlindungan brute-force tanpa membocorkan status `isActive`/`isVerified`.
- **Keputusan:**
  1. Jika `sendMail` gagal saat registrasi/resend OTP, row `RegistrationOtp` yang baru dibuat dihapus kembali agar pengguna dapat langsung melakukan `resend-otp` tanpa terblokir cooldown 60 detik oleh OTP yang gagal terkirim.
  2. Pada `login`, verifikasi password (`verifyPassword` atau `dummyCompare`) selalu dieksekusi lebih dulu sebelum memeriksa `lockedUntil`, `isActive`, atau `isVerified`; setelah 5 kegagalan beruntun akun dikunci 15 menit dan mengembalikan HTTP 429 `ACCOUNT_LOCKED`.

---

## ADR-009: Pemisahan Mutasi Stok Sparepart dari PATCH Umum

- **Tanggal:** 2026-11-12
- **Konteks:** Perubahan stok sparepart wajib memiliki alasan dan catatan audit yang jelas agar selisih inventaris dapat ditelusuri.
- **Keputusan:** Skema `PATCH /admin/spareparts/:id` tidak menerima field `stock`. Seluruh perubahan stok wajib melewati `POST /admin/spareparts/:id/adjust-stock` dengan `delta != 0`, `reason` wajib, pembaruan kondisional anti-negatif di transaksi, dan pencatatan `AuditLog` (`SPAREPART_STOCK_ADJUSTED`).

---

## ADR-010: Penanganan Password Sementara Saat Admin Membuat Staf

- **Tanggal:** 2026-11-12
- **Konteks:** Admin membuat akun staf (`ADMIN`/`MECHANIC`) dengan `mustChangePassword = true` dan password sementara dibuat server.
- **Keputusan:** Password sementara acak kriptografis dikirim melalui email pasca-commit dan ditampilkan satu kali pada respons `201 Created` (tidak pernah disimpan plaintext di DB atau log `pino`). Jika pengiriman email gagal di lingkungan dev/gangguan SMTP, pembuatan akun tidak di-rollback melainkan dicatat pada log warning agar admin tetap dapat menyerahkan password sementara tersebut.

---

## ADR-011: Perhitungan Slot Waktu & Penolakan Overbooking dengan Row Locking

- **Tanggal:** 2026-11-13
- **Konteks:** Ketersediaan slot operasional bengkel bergantung pada jam operasional (`openTime`/`closeTime`), interval `slotMinutes`, kapasitas `slotCapacity`, hari buka (`openDays`), hari libur (`OutletClosure`), lead time 60 menit, dan jendela 30 hari. Beberapa pengguna dapat memesan slot yang sama pada detik yang bersamaan.
- **Keputusan:**
  1. Perhitungan slot dimodelkan dalam modul murni `src/services/slots.js` menggunakan Luxon berbasis timezone outlet (`Asia/Jakarta`).
  2. Pencegahan overbooking dilakukan di dalam transaksi Prisma interaktif: baris outlet dikunci secara eksplisit menggunakan `lockOutlet(tx, outletId)` (`SELECT id FROM outlets WHERE id = ... FOR UPDATE`), jumlah reservasi aktif pada slot tersebut dihitung ulang, dan jika kapasitas penuh sistem melempar `409 ConflictError` (`SLOT_FULL`).

---

## ADR-012: Arsitektur State Machine Terpusat & Payload QR Code Bertanda Tangan HMAC-16

- **Tanggal:** 2026-11-13
- **Konteks:** Perubahan status transaksi booking memerlukan guard yang ketat (mis. cutoff pembatalan pelanggan 60 menit dan alasan wajib bagi admin) serta proteksi pemalsuan kode check-in di lokasi bengkel.
- **Keputusan:**
  1. Seluruh mutasi status wajib melewati `bookingStateMachine.transition(tx, bookingId, toStatus, actor, opts)` dengan update bersyarat (`updateMany` where `status: currentStatus` dan `count === 1`), penulisan `BookingLog`, serta penyiapan event realtime untuk di-emit setelah transaksi commit.
  2. Payload QR code di-generate sebagai `<code_booking>.<hmac16>` (16 karakter pertama dari HMAC-SHA256 kode booking dengan secret server) dan diverifikasi menggunakan `crypto.timingSafeEqual` pada waktu check-in.

---

### ADR-013: State Machine Transisi Deklaratif & Aturan Kepala Antrian Bengkel

- **Konteks:**
  Alur pengerjaan bengkel membutuhkan keteraturan agar nomor antrian tidak diselak, alokasi mekanik tidak melebihi kapasitas kerja (`MAX_ACTIVE_JOBS = 1`), dan pemotongan stok sparepart terjadi secara atomik hanya saat pengerjaan benar-benar dimulai.
- **Keputusan:**
  1. `bookingStateMachine.js` menjadi satu-satunya gerbang mutasi `Booking.status` dengan verifikasi deklaratif seluruh matriks transisi status.
  2. Pengerjaan bengkel (`startBooking` & `claimNextBooking`) memvalidasi kepala antrian: booking berstatus `CHECKED_IN` dengan `queueNumber` terkecil di mana `mechanicId IS NULL` atau sama dengan mekanik yang bersangkutan. Memulai booking selain kepala antrian ditolak dengan kode `409 QUEUE_ORDER_VIOLATION`.
  3. Pemotongan stok dilakukan secara bersyarat (`updateMany` dengan `where: { id, stock: { gte: qty } }`) di dalam transaksi terkunci `lockOutlet` sebelum status `IN_PROGRESS` ditetapkan. Jika gagal, transaksi di-rollback penuh dengan `409 STOCK_INSUFFICIENT`.
  4. Bila pembatalan dilakukan oleh admin saat booking berada di status `IN_PROGRESS` atau `WAITING_APPROVAL`, seluruh stok suku cadang yang telah dipotong otomatis dikembalikan.

---

### ADR-014: Isolasi Room Socket.IO & Otomasi Cron No-Show

- **Konteks:**
  Antarmuka web admin dan mobile customer memerlukan pembaruan status booking dan antrian secara realtime tanpa kebocoran data lintas-user. Selain itu, reservasi yang tidak dihadiri pelanggan perlu dibersihkan secara otomatis.
- **Keputusan:**
  1. Socket.IO menerapkan autentikasi JWT pada tahap handshake (mengecek user aktif, belum dihapus, dan kecocokan `tokenVersion`).
  2. Isolasi room diberlakukan ketat: setiap user hanya bergabung ke `user:${id}`, staf mekanik bergabung ke `outlet:${outletId}:staff`, dan admin bergabung ke `admin`. Dilarang keras melakukan broadcast global (`io.emit`).
  3. Job `noShow.job.js` dieksekusi secara periodik setiap 10 menit (zona waktu `Asia/Jakarta`) oleh `node-cron`, mengidentifikasi booking `PENDING` yang melewati batas toleransi keterlambatan (`slotEndAt + NO_SHOW_GRACE_MINUTES`), dan mengubah status menjadi `NO_SHOW` dengan actor `SYSTEM`.

---

### ADR-015: Penanganan Item Tambahan, Persetujuan Batch, dan Foto Inspeksi Privat

- **Konteks:**
  Penambahan pekerjaan atau penggantian suku cadang yang ditemukan selama servis membutuhkan transparansi total kepada pelanggan tanpa manipulasi harga, serta perlindungan file foto inspeksi bengkel agar tidak dapat diakses secara publik tanpa izin.
- **Keputusan:**
  1. Item tambahan hanya dapat diajukan oleh mekanik penangan / admin saat status `IN_PROGRESS` dan wajib menyertakan alasan. Penambahan memindahkan status booking secara otomatis ke `WAITING_APPROVAL`.
  2. Keputusan persetujuan (`decideBookingApprovals`) harus bersifat atomik dan menyeluruh: semua item `PENDING_APPROVAL` pada booking harus diputuskan dalam satu batch (tanpa persetujuan parsial diam-diam). Admin yang memutuskan atas nama pelanggan wajib mengisi catatan konfirmasi minimal 10 karakter yang dicatat pada `AuditLog`.
  3. Pemotongan stok suku cadang tambahan hanya dieksekusi saat status disetujui (`APPROVED`). Jika stok di gudang tidak mencukupi, transaksi digagalkan penuh (`409 STOCK_INSUFFICIENT`) dan total biaya booking tidak berubah.
  4. Seluruh foto inspeksi di-re-encode ke WebP maksimal 1920px (metadata EXIF dihapus) dan disimpan pada direktori privat `storage/private/booking-photos/<bookingId>/<uuid>.webp`. Akses file foto wajib melalui signed URL berumur pendek (`/files/booking-photo/:id?exp&sig`) yang diverifikasi dengan `timingSafeEqual`.
  5. Transisi ke `READY_FOR_PICKUP` dijaga ketat oleh state machine: wajib memiliki minimal 1 foto `BEFORE` dan 1 foto `AFTER`, tidak ada item tambahan yang masih berstatus `PENDING_APPROVAL`, dan total biaya dihitung ulang hanya dari item yang `APPROVED`.

---

### ADR-016: Integrasi Midtrans Snap Langsung, Penanganan Idempotent & Duplikasi Bayar, Serta Faktur PDF

- **Konteks:**
  Sistem pembayaran bengkel harus terlindungi dari pemalsuan status pembayaran, manipulasi nominal, pembayaran ganda (dua sesi Midtrans yang sama-sama dibayar), serta menjamin keaslian faktur (invoice) yang dicetak pelanggan.
- **Keputusan:**
  1. Integrasi Midtrans menggunakan HTTP langsung (`fetch` + Basic Auth Base64 `ServerKey:`) tanpa SDK pihak ketiga yang usang. Seluruh request keluar dibatasi timeout terukur (10 detik) dan penanganan kegagalan terisolasi (`502 MIDTRANS_GATEWAY_ERROR`).
  2. Nominal pembayaran selalu diambil dari database server (`booking.total`), dan rincian `item_details` dijumlahkan persis sama dengan `gross_amount` dengan panjang nama $\le$ 50 karakter. Pembuatan sesi Snap baru secara otomatis membatalkan percobaan `PENDING` sebelumnya via Core Cancel API.
  3. Webhook Midtrans (`POST /payments/midtrans/notification`) wajib memvalidasi `signature_key` secara timing-safe (SHA-512) dan melakukan konfirmasi ulang ke Core Status API Midtrans untuk menghindari notifikasi palsu.
  4. Penanganan Idempotent & Duplikasi:
     - Jika webhook mengirim status `settlement` berulang kali, respons 200 dikembalikan tanpa perubahan ganda.
     - Status yang sudah terminal (`PAID`, `REFUNDED`) tidak dapat diturunkan statusnya oleh notifikasi `pending` yang datang terlambat.
     - Jika dua percobaan pembayaran pada booking yang sama keduanya berhasil diselesaikan (settle), pembayaran pertama melunasi booking, sedangkan pembayaran kedua ditandai sebagai `DUPLICATE`, dicatat dalam `AuditLog`, dan sistem mengirimkan peringatan darurat ke seluruh Admin untuk proses refund manual via Midtrans Portal.
  5. Nomor faktur dialokasikan saat booking dinyatakan `PAID` dengan format unik `INV-YYYYMM-NNNNNN`.
  6. Faktur resmi (`GET /bookings/:id/invoice.pdf`) hanya dapat diunduh jika booking telah berstatus `PAID` (status belum lunas ditolak dengan `409 BOOKING_NOT_PAID`). Dokumen dibuat secara streaming menggunakan PDFKit berdasarkan snapshot item pekerjaan (bukan katalog aktif). Tip mekanik dikecualikan dari faktur karena bukan merupakan pendapatan bengkel.
  7. Penyelesaian booking (`completeBooking`) kini menegakkan guard ketat: status booking wajib `PAID`, dialokasikan nomor invoice, dan secara otomatis membangkitkan `ServiceReminder` untuk layanan berkala yang telah selesai.

---

### ADR-017: Notifikasi Terpusat, Ulasan Pasca-Servis, Pengingat Servis Berkala, dan Assistant Deterministik

- **Konteks:**
  Pengalaman pelanggan setelah servis memerlukan alur ulasan yang tertib tanpa ulasan palsu, pengingat servis berkala yang akurat berbasis tanggal dan kilometer odometer, notifikasi terpusat multi-channel (database, Socket.IO, Expo push) yang tidak boleh menggagalkan request utama, serta fitur bantuan cepat yang deterministik tanpa risiko halusinasi AI.
- **Keputusan:**
  1. Sentralisasi notifikasi melalui `notify(userId, { type, title, body, data })`:
     - Menyimpan record in-app ke database.
     - Memancarkan event realtime Socket.IO `notification:new` ke room `user:${userId}`.
     - Mengirimkan push notification secara non-blocking via `expo-server-sdk`. Jika Expo mengembalikan kode `DeviceNotRegistered`, token perangkat otomatis dibersihkan dari database (`DeviceToken`).
  2. Ulasan pelanggan (`POST /bookings/:id/review`):
     - Hanya dapat diberikan oleh pemilik booking yang telah berstatus `COMPLETED`.
     - Dibatasi maksimal 1 kali per booking dan dalam rentang 30 hari (`RULES.REVIEW_WINDOW_DAYS`) setelah selesai.
     - Ulasan publik outlet (`GET /outlets/:id/reviews`) dianonimkan (hanya nama depan pelanggan yang ditampilkan) dan menyaring ulasan yang disembunyikan (`isHidden: false`).
     - Staf mekanik dapat memantau rating performa pribadinya via `GET /staff/me/reviews`, dan Admin berwenang memoderasi visibilitas ulasan via `PATCH /admin/reviews/:id/visibility`.
  3. Pengingat Servis Berkala (`ServiceReminder`):
     - Dibangkitkan secara otomatis dan idempotent saat booking `COMPLETED` untuk layanan yang memiliki interval hari atau KM.
     - Reminder lama untuk pasangan `vehicleId` dan `serviceId` yang sama otomatis ditandai `DONE`.
     - Evaluasi ganda: (a) Cron harian pada pukul 08:00 WIB memeriksa jatuh tempo waktu (H-7 transisi ke `REMINDED`, Hari-H transisi ke `DUE`), (b) Real-time trigger saat odometer kendaraan diperbarui melebihi `dueOdometerKm` langsung mentransisikan reminder ke `DUE`.
     - Cron reminder dirancang idempotent sehingga eksekusi ganda pada hari yang sama tidak mengirimkan notifikasi duplikat.
  4. Assistant Tanpa AI (`POST /assistant/query`):
     - Menolak input teks bebas dan tidak menggunakan Large Language Model (LLM) guna menjamin keakuratan 100% dan mencegah halusinasi.
     - Menggunakan skema diskriminatif Zod (`z.discriminatedUnion("intent", [...])`) untuk 5 menu intent: `CHECK_SLOT`, `OUTLET_OPEN_STATUS`, `MY_BOOKING_STATUS`, `SERVICE_PRICE_LIST`, dan `MY_NEXT_SERVICE`.
     - Seluruh intent me-reuse langsung service domain yang sudah ada (`slots.js`, `outlets.service.js`, `bookings.service.js`, `catalog.service.js`, `reminders.service.js`).

---

### ADR-018: Dashboard Analitik, Definisi Pendapatan Bersih, Sanitasi Formula Injection, dan Ekspor Laporan Streaming

- **Konteks:**
  Manajemen operasional bengkel memerlukan dashboard eksekutif dan pelaporan berkala yang efisien tanpa membebani memori server (anti N+1 query). Pelaporan finansial harus memisahkan hak bengkel dengan tip pekerja, file spreadsheet harus kebal terhadap serangan formula injection (CSV/Excel Formula Injection), dokumen ekspor harus dapat di-stream dalam format CSV, XLSX, dan PDF dengan pencatatan audit log, serta staf mekanik berhak melihat rekap tip miliknya tanpa membocorkan privasi pelanggan.
- **Keputusan:**
  1. Definisi Pendapatan Bersih (Net Revenue):
     - Pendapatan bengkel didefinisikan secara ketat sebagai akumulasi $\sum$ pembayaran `INVOICE` berstatus `PAID` dikurangi nominal `REFUNDED`.
     - Tip mekanik (`Payment` bertipe `TIP`) dicatat secara terpisah dan secara eksplisit dikeluarkan dari pendapatan bengkel.
  2. Aggregasi Metrik Performa & Dashboard (`GET /admin/dashboard`):
     - Menggunakan Prisma `aggregate` dan `groupBy` terindeks untuk mengukur perbandingan pendapatan hari ini, bulan ini, dan tahun ini terhadap periode sebelumnya beserta persentase pertumbuhannya.
     - Menyediakan metrik antrian aktif hari ini, tingkat ketidakhadiran (_no-show rate_), rata-rata waktu tunggu pelanggan (_checked-in_ s/d _started_), rata-rata durasi pengerjaan servis (_started_ s/d _ready_), top 5 layanan terlaris berdasarkan subtotal pendapatan (bukan sekadar kuantitas booking), leaderboard performa mekanik, serta peringatan sparepart stok menipis (`stock <= RULES.LOW_STOCK_THRESHOLD`).
     - Semua batasan tanggal dihitung berdasarkan zona waktu bengkel (`RULES.TIMEZONE` = `Asia/Jakarta`).
  3. Perlindungan Formula Injection (CSV / XLSX):
     - Fungsi murni `sanitizeCell` memeriksa setiap nilai sel bertipe string. Bila sel diawali dengan karakter risiko formula (`=`, `+`, `-`, `@`), karakter tersebut otomatis diprefiks dengan tanda petik tunggal `'` untuk menetralisir eksekusi rumus/DDE di aplikasi lembar kerja.
  4. Ekspor Laporan Multi-Format & Audit Log (`GET /admin/reports/export`):
     - Mendukung tipe dataset `revenue`, `bookings`, `mechanics`, `services`, dan `stock`.
     - Mendukung format output: `csv` (dengan UTF-8 BOM untuk kompatibilitas Excel), `xlsx` (styling tabel rapi via `ExcelJS`), dan `pdf` (layout dokumen terstruktur via `PDFKit`).
     - Setiap aktivitas ekspor wajib terekam ke tabel `AuditLog` dengan action `REPORT_EXPORTED` menyertakan aktor, tipe, format, dan parameter tanggal/outlet.
     - Validasi rentang tanggal dibatasi maksimal 366 hari (`RULES.REPORT_MAX_RANGE_DAYS`).
  5. Privasi Tip Mekanik (`GET /staff/me/tips`):
     - Staf mekanik hanya dapat mengakses data tip yang dialokasikan ke dirinya (`recipientMechanicId: actor.id`).
     - Bentuk respons menggunakan Prisma `select` ketat (`staffTipSelect`) yang hanya menampilkan ID pembayaran, order ID, nominal tip, status, tanggal pembayaran, dan kode booking, tanpa pernah menyertakan nama lengkap, email, nomor telepon, atau alamat pelanggan.

---

### ADR-019: Standarisasi Tautan Email, Deep Link Mobile, dan Konfigurasi Cookie Refresh Token (Fase I-1)

- **Tanggal:** 2026-11-14
- **Konteks:**
  Frontend Web (Next.js 16) berjalan pada port 3000 secara default, sedangkan backend API berjalan pada port 5000. Untuk pengujian mobile (Expo) dan web, tautan email (reset password) dan deep link harus selaras dengan rute klien, cookie sesi refresh token harus dapat melintasi port development yang berbeda tanpa melanggar kebijakan SameSite browser, dan gap field master data (`managerName` pada Outlet, `badge`/`imageUrl`/`checklist` pada Service) harus disinkronisasikan.
- **Keputusan:**
  1. Tautan Reset Password Web & Mobile Deep Link:
     - Tautan Web diselaraskan ke `${WEB_URL}/reset-password?token=${rawToken}` (di mana `WEB_URL` default adalah `http://localhost:3000`).
     - Tautan Mobile Deep Link menggunakan skema `tallero://reset-password?token=${rawToken}` sesuai spesifikasi `app.json` Expo (`scheme: "tallero"`).
  2. Pengaturan Cookie Refresh Token:
     - Cookie bersifat `httpOnly: true` (tidak dapat diakses oleh skrip JavaScript di browser guna memitigasi serangan XSS).
     - Path cookie dibatasi ketat ke `/api/v1/auth` sehingga browser hanya mengirimkan cookie pada endpoint refresh dan logout.
     - Variabel lingkungan `COOKIE_SAME_SITE` (default `lax` pada dev localhost lintas port, `strict` pada produksi), `COOKIE_PATH`, `COOKIE_DOMAIN`, dan `COOKIE_SECURE` disediakan agar perilaku cookie dapat disesuaikan tanpa modifikasi kode sumber.
  3. Perluasan Field Master Data:
     - Menambahkan field `managerName` (`VARCHAR(100)`) pada model `Outlet` untuk menampilkan nama kepala cabang di UI admin.
     - Menambahkan field `badge` (`VARCHAR(50)`), `imageUrl` (`VARCHAR(500)`), dan `checklist` (`Json`) pada model `Service` untuk mendukung katalog pemasaran di antarmuka pelanggan dan admin.
  4. Aksesibilitas Jaringan Lokal & Header CORS:
     - Server backend mendengarkan pada host `0.0.0.0` (dikonfigurasi via `HOST` di `.env`) agar dapat diakses dari emulator Android (`10.0.2.2:5000`), simulator iOS (`localhost:5000`), dan perangkat fisik via IP LAN lokal.
     - Meng-expose header `Content-Disposition` pada konfigurasi CORS agar browser frontend dapat membaca nama file unduhan (PDF invoice dan berkas ekspor laporan).

### ADR-020: Perbaikan transaksi dan integrasi web (18 November 2026)

- Kunci customer lalu outlet menjaga batas booking lintas outlet. Pembayaran memakai kunci booking; invoice memakai advisory transaction lock bersama. Harga tetap berasal dari snapshot server.
- Gross adalah penerimaan invoice PAID maupun yang kemudian REFUNDED pada paidAt. Refund dikurangi sekali pada periode pengembalian; tip dipisahkan. Ini memperjelas dan menggantikan rumus status pada ADR-018.
- Query availability memakai hari lokal outlet, sedangkan kolom date closure/queueDate mempertahankan semantik tanggal kalender.
- PostgreSQL test wajib tersedia; kegagalan setup tidak boleh berubah menjadi tes lulus tanpa eksekusi.
- Database lokal lama tallero_db dipertahankan. Karena skemanya tidak cocok dan seluruh tabelnya kosong, aplikasi memakai database baru tallero_dev dengan initial migration. TEST_DATABASE_URL tetap milik pengguna.
- Frontend Next.js memakai cookie refresh httpOnly, access token dalam memori, refresh single-flight, role guard, dan event Socket.IO. WEB_URL lokal adalah http://localhost:3000.
- Rincian perbaikan, pengujian, dan batasan eksternal ada di VERIFICATION_2026-11-18.md. Tidak ada jaminan perangkat lunak bebas bug 100%.

### ADR-021: Kode provider Midtrans dan setup Gmail (18 November 2026)

- Status API Midtrans dapat mengirim HTTP 200 dengan kode provider 404 sebelum pemilihan metode Snap. Transport memeriksa kode JSON, menolak respons/order yang tidak valid, dan mempertahankan payment lokal PENDING ketika transaksi Core belum ada. Pengujian tidak mengubah database development.
- Driver Gmail tetap dinonaktifkan sampai refresh token valid; pemeriksaan saat ini ditolak invalid_grant. Redirect Playground harus didaftarkan persis pada client Web application yang sama. Petunjuk ada pada EMAIL_SETUP.md.
- Client Key tidak dihapus meski alur redirect Snap belum memakainya, karena disiapkan untuk embed Snap/Core API. Nilai production perlu diganti sandbox sebelum digunakan. Tidak menebak atau mengubah key/token pengguna.

### ADR-022: Log HTTP ringkas dan SQL opt-in (18 November 2026)

- Development memakai info secara default agar satu login/dashboard tidak memenuhi terminal dengan query SQL dan seluruh header HTTP. `LOG_LEVEL` dapat diatur; `LOG_SQL_QUERIES` false secara default dan hanya berlaku pada development.
- Serializer HTTP hanya menyertakan request ID, method, path tanpa query string dan status respons. Ini juga mencegah cookie respons serta token pada query ikut dicetak. Error dan warn tetap dicatat.
- Verifikasi login admin/dashboard HTTP 200, pemeriksaan tidak adanya marker cookie/query token di log, dan suite backend dilakukan setelah perubahan. Tidak ada perubahan endpoint atau data bisnis.

### ADR-023: Kontrak JWT yang sama pada HTTP dan Socket.IO (18 November 2026)

- Socket.IO menggunakan verifyAccessToken yang sama dengan middleware HTTP. Token aplikasi menyimpan ID pada subject sub, bukan userId mentah; parser bersama memvalidasi ID positif dan tokenVersion sebelum query.
- Fixture unit Socket.IO memakai signAccessToken aplikasi, sehingga tidak lagi membentuk kontrak token sendiri yang berbeda dari login. Ditambahkan lima kasus subject tidak valid yang harus ditolak tanpa query Prisma.
- Verifikasi jaringan memakai token hasil login admin nyata pada proses dev pengguna, ditambah penolakan token ditandatangani tanpa subject. Perbaikan sebelumnya pada logging tidak cukup untuk menemukan masalah ini; pesan Prisma id undefined pada lampiran mengidentifikasi akar masalah.
