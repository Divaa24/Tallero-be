# TALLERO AUTO — PEMETAAN LAYAR KE ENDPOINT API (SCREEN_ENDPOINT_MAP.md)

Dokumen ini memetakan arsitektur navigasi layar aplikasi **Web Admin Portal** dan **Mobile Apps** terhadap 106 endpoint API Backend **Tallero Auto**, disusun secara berurutan mengikuti perjalanan pengguna (*user journey*).

---

## 1. Alur Publik & Autentikasi (Web & Mobile)

| No | Nama Layar / Tampilan | Peran Aktor | Kebutuhan Data & Aksi Pengguna | Endpoint API yang Digunakan |
|:---|:---|:---:|:---|:---|
| 1 | **Landing Page / Beranda Publik** | `ANON` | Menampilkan hero banner, paket servis unggulan, daftar cabang bengkel, dan ulasan pelanggan. | `GET /api/v1/services`<br>`GET /api/v1/categories`<br>`GET /api/v1/outlets` |
| 2 | **Layar Registrasi Pelanggan** | `ANON` | Formulir nama, email, nomor HP, dan password akun pelanggan baru. | `POST /api/v1/auth/register` |
| 3 | **Layar Verifikasi OTP** | `ANON` | Input 6-digit kode OTP email dan tombol hitung mundur kirim ulang. | `POST /api/v1/auth/verify-otp`<br>`POST /api/v1/auth/resend-otp` |
| 4 | **Layar Login** | `ANON` | Input email & password untuk seluruh pengguna (Admin, Mekanik, Pelanggan). | `POST /api/v1/auth/login` |
| 5 | **Layar Lupa Password** | `ANON` | Formulir permintaan link reset password via email. | `POST /api/v1/auth/forgot-password` |
| 6 | **Layar Reset Password** | `ANON` | Membuka tautan email dan menginput password baru. | `POST /api/v1/auth/reset-password` |
| 7 | **Layar Wajib Ganti Password** | `AUTH` | Layar paksa ganti password bagi staf yang baru dibuatkan akun oleh Admin. | `POST /api/v1/auth/change-password` |
| 8 | **Profil Akun Saya** | `AUTH` | Melihat dan mengedit biodata profil serta mengunggah foto avatar. | `GET /api/v1/auth/me`<br>`PATCH /api/v1/auth/me`<br>`POST /api/v1/auth/me/avatar` |

---

## 2. Alur Pelanggan / Customer (Mobile App & Web Pelanggan)

| No | Nama Layar / Tampilan | Kebutuhan Data & Aksi Pengguna | Endpoint API yang Digunakan |
|:---|:---|:---|:---|
| 1 | **Dashboard Utama Pelanggan** | Menampilkan kartu booking aktif berjalan, shortcut garasi mobil, notifikasi, dan rekomendasi servis. | `GET /api/v1/bookings`<br>`GET /api/v1/vehicles`<br>`GET /api/v1/notifications/unread-count` |
| 2 | **Katalog Servis & Detail Paket** | Eksplorasi paket perbaikan, estimasi biaya, checklist servis, dan filter jenis mobil/motor. | `GET /api/v1/services`<br>`GET /api/v1/services/:id`<br>`GET /api/v1/categories` |
| 3 | **Pilih Cabang & Cek Slot Waktu** | Memilih lokasi outlet terdekat dan memeriksa ketersediaan jam slot pada tanggal reservasi. | `GET /api/v1/outlets`<br>`GET /api/v1/outlets/:id/availability?date=YYYY-MM-DD` |
| 4 | **Formulir Reservasi Booking** | Memilih kendaraan, paket servis, jadwal slot, keluhan tambahan, dan konfirmasi booking. | `POST /api/v1/bookings` |
| 5 | **Garasi Saya (Manajemen Kendaraan)** | Daftar kendaraan milik pelanggan, formulir tambah mobil baru, edit warna/odometer, dan hapus. | `GET /api/v1/vehicles`<br>`POST /api/v1/vehicles`<br>`PATCH /api/v1/vehicles/:id`<br>`DELETE /api/v1/vehicles/:id` |
| 6 | **Riwayat & Pengingat Servis Mobil** | Melihat jejak servis masa lalu suatu kendaraan dan jadwal pengingat ganti oli/servis berkala. | `GET /api/v1/vehicles/:id/history`<br>`GET /api/v1/vehicles/:id/reminders` |
| 7 | **Pelacak Status Booking Berjalan** | Stepper status pengerjaan mobil (`PENDING` $\rightarrow$ `CHECKED_IN` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ dst). | `GET /api/v1/bookings/:id`<br>Socket event `booking:status_changed` |
| 8 | **Tiket QR Code Check-in** | Tampilan QR Code bertanda tangan digital untuk dipindai staf di pintu masuk cabang. | `GET /api/v1/bookings/:id/qr` |
| 9 | **Pantauan Posisi Antrean Unit** | Menampilkan nomor antrean pit dan estimasi waktu tunggu pengerjaan. | `GET /api/v1/bookings/:id/queue-position` |
| 10 | **Persetujuan Item Tambahan** | Daftar rekomendasi perbaikan/suku cadang tambahan dari mekanik; tombol setujui/tolak per item. | `GET /api/v1/bookings/:id`<br>`POST /api/v1/bookings/:id/approvals` |
| 11 | **Galeri Foto Inspeksi Servis** | Tampilan foto kondisi fisik sebelum pengerjaan (`BEFORE`) dan setelah servis selesai (`AFTER`). | `GET /api/v1/bookings/:id/photos` |
| 12 | **Layar Pembayaran Tagihan Servis** | Ringkasan tagihan akhir servis dan tombol pembayaran online via pop-up Midtrans Snap. | `POST /api/v1/bookings/:id/payments/midtrans`<br>Socket event `payment:updated` |
| 13 | **Layar Unduh Faktur Resmi** | Unduhan berkas PDF faktur pelunasan servis bengkel. | `GET /api/v1/bookings/:id/invoice.pdf` |
| 14 | **Layar Ulasan & Rating Servis** | Memberikan penilaian 1-5 bintang dan ulasan komentar kepuasan pengerjaan servis. | `POST /api/v1/bookings/:id/review` |
| 15 | **Layar Beri Tip Mekanik** | Mengirimkan uang tip apresiasi langsung kepada mekanik via Midtrans Snap. | `POST /api/v1/bookings/:id/tips` |
| 16 | **Pusat Notifikasi Pelanggan** | Daftar riwayat pemberitahuan sistem dan tombol tandai telah dibaca. | `GET /api/v1/notifications`<br>`PATCH /api/v1/notifications/:id/read`<br>`POST /api/v1/notifications/read-all` |
| 17 | **Asisten Bengkel Interaktif** | Chat/konsultasi kendala mobil dan pengecekan jadwal servis otomatis via asisten pintar. | `GET /api/v1/assistant/menu`<br>`POST /api/v1/assistant/query` |

---

## 3. Alur Staf Mekanik (Mobile / Tablet Pit Bengkel)

| No | Nama Layar / Tampilan | Kebutuhan Data & Aksi Pengguna | Endpoint API yang Digunakan |
|:---|:---|:---|:---|
| 1 | **Antrean Pit Cabang Hari Ini** | Memantau urutan antrean mobil yang masuk hari ini di cabang penugasan mekanik. | `GET /api/v1/staff/queue`<br>Socket event `queue:updated` |
| 2 | **Pemindai Kamera Check-in Gerbang** | Memindai QR Code tiket mobil pelanggan di gerbang masuk dan mencatat odometer fisik. | `POST /api/v1/bookings/check-in` |
| 3 | **Klaim / Mulai Pengerjaan Mobil** | Mengklaim unit terdepan antrean atau memulai pengerjaan unit yang di-assign. | `POST /api/v1/staff/queue/claim-next`<br>`POST /api/v1/bookings/:id/start` |
| 4 | **Pengerjaan Unit di Pit Servis** | Informasi keluhan pelanggan, catatan teknis mekanik, dan status komponen mobil. | `GET /api/v1/bookings/:id`<br>`PATCH /api/v1/bookings/:id/inspection` |
| 5 | **Upload Bukti Foto Inspeksi** | Mengambil dan mengunggah foto komponen sebelum (`BEFORE`) dan sesudah perbaikan (`AFTER`). | `POST /api/v1/bookings/:id/photos`<br>`DELETE /api/v1/bookings/:id/photos/:photoId` |
| 6 | **Rekomendasi Item & Part Tambahan** | Menambahkan daftar suku cadang/jasa tambahan yang ditemukan saat pemeriksaan. | `POST /api/v1/bookings/:id/items`<br>`DELETE /api/v1/bookings/:id/items/:itemId` |
| 7 | **Penyelesaian Servis Fisik** | Menandai mobil telah selesai dikerjakan fisik dan siap diambil pelanggan (`READY_FOR_PICKUP`). | `POST /api/v1/bookings/:id/ready` |
| 8 | **Riwayat Servis & Performa Mekanik** | Daftar pekerjaan servis yang telah selesai, ulasan rating pelanggan, dan rekap tip diterima. | `GET /api/v1/staff/me/jobs`<br>`GET /api/v1/staff/me/reviews`<br>`GET /api/v1/staff/me/tips` |

---

## 4. Alur Administrator Bengkel (Web Admin Portal)

| No | Nama Layar / Tampilan | Kebutuhan Data & Aksi Pengguna | Endpoint API yang Digunakan |
|:---|:---|:---|:---|
| 1 | **Dashboard Eksekutif Utama** | Metrik omzet hari/bulan ini, unit servis berjalan, tingkat no-show, dan stok menipis. | `GET /api/v1/admin/dashboard` |
| 2 | **Manajemen Seluruh Booking** | Tabel seluruh booking lintas cabang, filter status, pencarian plat/kode, dan detail. | `GET /api/v1/bookings`<br>`GET /api/v1/bookings/:id`<br>`GET /api/v1/bookings/:id/logs` |
| 3 | **Penugasan Mekanik Spesifik** | Menugaskan mekanik tertentu pada booking yang telah check-in. | `POST /api/v1/bookings/:id/assign` |
| 4 | **Kasir Pembayaran Tunai** | Mencatat pembayaran fisik langsung di meja kasir dan melunasi tagihan booking. | `POST /api/v1/bookings/:id/payments/cash` |
| 5 | **Persetujuan Item via Telepon** | Admin menyetujui item perbaikan atas nama pelanggan setelah konfirmasi panggilan telepon. | `POST /api/v1/bookings/:id/approvals` |
| 6 | **Tutup & Selesaikan Transaksi** | Menutup transaksi booking yang sudah lunas menjadi status `COMPLETED`. | `POST /api/v1/bookings/:id/complete` |
| 7 | **Pembatalan Darurat Admin** | Membatalkan booking dengan menyertakan alasan tertulis resmi. | `POST /api/v1/bookings/:id/cancel` |
| 8 | **Sinkronisasi Status Midtrans** | Sinkronisasi manual status transaksi jika webhook tertunda. | `POST /api/v1/payments/:orderId/sync` |
| 9 | **Kelola Cabang Outlet** | Daftar seluruh cabang, tambah cabang baru, edit jam kerja/pit, soft delete, dan restore. | `GET /api/v1/admin/outlets`<br>`POST /api/v1/admin/outlets`<br>`PATCH /api/v1/admin/outlets/:id`<br>`DELETE /api/v1/admin/outlets/:id`<br>`POST /api/v1/admin/outlets/:id/restore` |
| 10 | **Kalender Libur Cabang** | Mengatur tanggal tutup khusus atau libur operasional cabang bengkel. | `POST /api/v1/admin/outlets/:id/closures`<br>`DELETE /api/v1/admin/outlets/:id/closures/:closureId` |
| 11 | **Kelola Master Kategori Servis** | CRUD master data kategori paket servis kendaraan. | `GET /api/v1/admin/categories`<br>`POST /api/v1/admin/categories`<br>`PATCH /api/v1/admin/categories/:id`<br>`DELETE /api/v1/admin/categories/:id`<br>`POST /api/v1/admin/categories/:id/restore` |
| 12 | **Kelola Master Paket Layanan** | CRUD paket servis, harga jasa, estimasi menit kerja, dan interval pengingat servis. | `GET /api/v1/admin/services`<br>`POST /api/v1/admin/services`<br>`PATCH /api/v1/admin/services/:id`<br>`DELETE /api/v1/admin/services/:id`<br>`POST /api/v1/admin/services/:id/restore` |
| 13 | **Kelola Master Suku Cadang** | CRUD suku cadang, SKU, harga, stok fisik, dan penyesuaian stok opname manual. | `GET /api/v1/admin/spareparts`<br>`POST /api/v1/admin/spareparts`<br>`PATCH /api/v1/admin/spareparts/:id`<br>`DELETE /api/v1/admin/spareparts/:id`<br>`POST /api/v1/admin/spareparts/:id/restore`<br>`POST /api/v1/admin/spareparts/:id/adjust-stock` |
| 14 | **Kelola Staf & Pengguna** | Daftar akun, pembuatan akun mekanik/admin baru, blokir akun, dan restore. | `GET /api/v1/admin/users`<br>`POST /api/v1/admin/users`<br>`GET /api/v1/admin/users/:id`<br>`PATCH /api/v1/admin/users/:id`<br>`PATCH /api/v1/admin/users/:id/status`<br>`DELETE /api/v1/admin/users/:id`<br>`POST /api/v1/admin/users/:id/restore` |
| 15 | **Moderasi Ulasan Pelanggan** | Meninjau ulasan dan menyembunyikan ulasan yang mengandung unsur ofensif/spam. | `PATCH /api/v1/admin/reviews/:id/visibility` |
| 16 | **Audit Trail Log Keamanan** | Jejak rekam audit modifikasi data sistem dan transaksi sensitif bengkel. | `GET /api/v1/admin/audit-logs` |
| 17 | **Laporan Operasional & Ekspor** | Filter analitik performa dan unduh laporan ke format Excel (`.xlsx`), PDF, atau CSV. | `GET /api/v1/admin/reports/summary`<br>`GET /api/v1/admin/reports/export` |

