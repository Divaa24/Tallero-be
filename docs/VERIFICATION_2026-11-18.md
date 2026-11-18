# Perbaikan dan verifikasi integrasi 18 November 2026

Dokumen ini menggantikan kesimpulan audit lama yang mengandalkan tes integrasi yang berhenti diam-diam saat database tidak tersedia.

## Perbaikan

- Hasil validasi params/query/body dipertahankan pada middleware berlapis. Skema availability dan ulasan outlet menggunakan bentuk yang sesuai middleware.
- Persetujuan admin menggunakan model AuditLog yang benar, dengan ID string dan keputusan pada field `after`.
- Sinkronisasi pembayaran dibatasi pada customer pemilik dan admin. Mulai pekerjaan memvalidasi role, outlet, status aktif, dan penugasan mekanik.
- Pembuatan booking mengunci customer dan outlet sebelum memeriksa batas kendaraan, customer, dan kapasitas slot. Perhitungan snapshot tetap dilakukan server.
- Cash, settlement webhook, dan penyimpanan percobaan Snap menggunakan kunci booking. Nomor invoice dialokasikan di bawah kunci transaksi bersama lintas outlet. Webhook yang diputar ulang tidak menggandakan pembayaran, notifikasi, atau penanganan duplicate.
- Gross penerimaan mencakup payment yang kemudian direfund; refund dikurangi sekali pada periodenya. Tip tetap terpisah.
- Rekonsiliasi mencakup payment overdue dalam jendela pemulihan 30 hari. Hari availability dan daftar booking menggunakan batas hari lokal yang dikonversi ke UTC.
- Servis ulang menutup reminder DUE. Batas gagal login menggunakan pembaruan bersyarat, dan sesi tidak diterbitkan dari hash password/version yang sudah berubah. Percobaan OTP diperbarui atomik.
- Seed diperbaiki agar modul QR, Category, dan ServiceReminder sesuai kode/skema saat ini. Seed lengkap diuji idempotent pada PostgreSQL.
- Operasi login, verifikasi OTP, logout dan perubahan password berbagi Web Lock dengan refresh agar cookie sesi tidak tertimpa respons yang terlambat. Sesi frontend yang baru juga menolak hasil refresh lama; gangguan refresh sementara tidak langsung menghapus sesi.
- Tes database gagal jelas bila setup gagal; urutan pembersihan mengikuti foreign key. Fixture waktu relatif, dan matriks yang membandingkan evaluator dengan dirinya sendiri diganti pemeriksaan kontrak routes/dokumentasi.

## Database lokal

`tallero_db` adalah skema lama yang tidak cocok dengan backend terbaru. Pemeriksaan awal menemukan delapan tabel lama dengan nol record. Database ini dipertahankan.

Database baru `tallero_dev` dibuat dan diberi initial migration `202611180001_initial`. `DATABASE_URL` lokal diarahkan ke database ini. Admin awal dibuat menggunakan `SEED_ADMIN_*` yang sudah ada di `.env`; password tidak disertakan dalam laporan. Data percobaan browser ditempatkan di database audit terpisah, bukan database development ini.

`TEST_DATABASE_URL` tetap mengarah ke `tallero_test_db` milik pengguna. Sebelum tes, target ini diverifikasi terpisah dan kosong. URL test yang mengarah ke database yang sama dengan development ditolak, termasuk bila menggunakan schema yang berbeda di database yang sama.

`WEB_URL` diselaraskan ke `http://localhost:3000`, agar tautan reset password membuka frontend yang benar. CORS tetap memakai whitelist.

## Verifikasi

Hasil akhir: **209 tes lulus pada 38 berkas**, tanpa tes dilewati. Lint backend/frontend, pemeriksaan TypeScript, build produksi frontend, validasi Prisma, dan status migrasi lulus. **20 skenario browser** lulus tanpa page error atau respons API 5xx, ditambah dua regresi sesi dengan respons jaringan terkontrol (login bersamaan dengan refresh dan gangguan refresh sementara). Smoke test tambahan pada database development membuktikan readiness HTTP 200, admin login, refresh setelah reload, logout, dan katalog kosong yang ditangani dengan jelas.

Jalankan `npm run lint`, `npm test`, dan `npx prisma validate` dari root backend. Tes PostgreSQL meliputi:

- 200 perebutan slot pada 10 iterasi.
- Batas satu booking aktif kendaraan dan tiga booking customer pada outlet berbeda.
- 20 request cash bersamaan, delapan invoice lintas booking, webhook berulang, dua settlement berbeda, serta cash melawan settlement.
- Siklus HTTP booking ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ QR/check-in ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ assign/start ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ item/persetujuan ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ foto ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ready ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ cash ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ complete ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ invoice/review.
- Login salah dan OTP salah bersamaan, serta perubahan password ketika verifikasi login masih berlangsung.
- Reminder DUE, refund, rekonsiliasi overdue, soft delete, akun, kendaraan, master data, dan seed idempotent.

Laporan mentah dan hasil browser disimpan pada direktori outputs chat Codex. Jangan menyimpulkan bebas bug 100% dari jumlah tes. Alur yang diuji dan layanan eksternal yang belum dapat diverifikasi harus dibedakan.

## Layanan eksternal

Pemeriksaan awal mendapat HTTP 401. Setelah pengguna memperbarui Server Key, pemeriksaan sandbox diterima; pembuatan sesi Snap melalui API menghasilkan HTTP 201, halaman checkout sandbox termuat, dan sinkronisasi sebelum pemilihan metode tetap PENDING. Tidak ada uang nyata atau settlement nyata diuji. Client Key masih berformat production; integrasi redirect saat ini belum memakainya, tetapi nilainya perlu diselaraskan sebelum embed Snap/Core API.

Status API dapat mengirim HTTP 200 dengan `status_code=404` saat Snap belum menjadi transaksi Core. Transport kini membaca kode provider dan memvalidasi order; sinkronisasi local payment PENDING mempertahankan status saat metode belum dipilih. Ditambahkan tujuh tes regresi.

Email lokal masih menggunakan driver `console`; pemeriksaan token menghasilkan `invalid_grant`. Pengguna melaporkan `redirect_uri_mismatch` pada Playground. Petunjuk perbaikan ada di [EMAIL_SETUP.md](EMAIL_SETUP.md). Alur register/reset dan validasi token sudah diuji, tetapi pengiriman Gmail nyata belum diverifikasi. Uji browser menggunakan OTP dan token reset khusus fixture pada database audit. Expo tidak mengirim push nyata selama tes.

Audit dependency runtime frontend tidak menemukan advisori setelah pembaruan Next.js dan pemindahan CLI shadcn ke dependency development. Backend masih mempunyai dua advisori moderate pada rantai ExcelJS/uuid; perbaikan otomatis mengusulkan perubahan major yang tidak diterapkan. Dependency development frontend juga mempunyai advisori glob/regex yang belum diselesaikan dengan perubahan paksa. Tidak ada klaim bahwa audit dependency seluruh proyek sudah bersih.

Driver pg masih menampilkan peringatan deprecation saat query/transaksi bersamaan pada kombinasi Prisma adapter saat ini. Seluruh invarians transaksi yang diuji tetap lulus; kompatibilitas sebelum upgrade major pg 9 perlu diperiksa kembali.

Perbaikan lanjutan dari log pengguna: Socket.IO kini membaca subject JWT melalui verifyAccessToken yang sama dengan HTTP. Fixture unit memakai signer aplikasi dan lima subject invalid ditolak sebelum query. Koneksi socket jaringan memakai token hasil login admin nyata telah berhasil.
