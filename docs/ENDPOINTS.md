# TALLERO AUTO — DAFTAR LENGKAP ENDPOINT (106 ENDPOINTS)

Dokumen ini memuat seluruh endpoint API Backend **Tallero Auto** (106 endpoint), diturunkan langsung dari `src/routes/` dan `docs/openapi.json`. Dokumen ini menjadi rujukan ringkas bagi tim Web Admin (React/Next.js) dan Mobile Apps (Expo/React Native).

---

## 1. Legenda & Konvensi Kolom

- **Method**: Kata kerja HTTP (`GET`, `POST`, `PATCH`, `DELETE`).
- **Path**: Jalur URL dengan prefix `/api/v1`.
- **Role yang Boleh**:
  - `ANON`: Publik (tanpa autentikasi).
  - `CUSTOMER`: Pelanggan bengkel.
  - `MECHANIC`: Staf mekanik bengkel (terikat cabang).
  - `ADMIN`: Administrator bengkel (akses global).
  - `STAFF`: Berlaku untuk `MECHANIC` dan `ADMIN`.
  - `AUTH`: Semua pengguna yang sudah login (`CUSTOMER`, `MECHANIC`, `ADMIN`).
- **Parameter**:
  - `Body`: Membutuhkan payload JSON atau form-data pada body request.
  - `Query`: Menerima query parameter (mis. pagination, search, filter tanggal).
  - `Params`: Menerima parameter path URL (mis. `:id`, `:orderId`).
  - `-`: Tidak memerlukan parameter khusus.
- **Tag Pengguna**:
  - `WEB`: Digunakan oleh Web Admin/Portal Bengkel.
  - `MOBILE`: Digunakan oleh Mobile App Pelanggan/Mekanik.
  - `KEDUANYA`: Digunakan oleh Web dan Mobile.

---

## 2. Tabel 106 Endpoint API

| No | Method | Path | Role yang Boleh | Ringkasan Fungsi | Body / Query / Params | Kode Error Umum | Tag Klien |
|:---|:---|:---|:---|:---|:---|:---|:---|
| 1 | `GET` | `/api/v1/health` | `ANON` | Liveness probe status server | - | - | `KEDUANYA` |
| 2 | `GET` | `/api/v1/ready` | `ANON` | Database readiness check | - | `500` | `KEDUANYA` |
| 3 | `POST` | `/api/v1/auth/register` | `ANON` | Registrasi akun pelanggan baru (memicu kirim OTP) | `Body` | `400, 429, 502` | `KEDUANYA` |
| 4 | `POST` | `/api/v1/auth/verify-otp` | `ANON` | Verifikasi OTP registrasi & aktifkan akun | `Body` | `400, 429` | `KEDUANYA` |
| 5 | `POST` | `/api/v1/auth/resend-otp` | `ANON` | Kirim ulang OTP registrasi (cooldown 60s) | `Body` | `400, 429, 502` | `KEDUANYA` |
| 6 | `POST` | `/api/v1/auth/login` | `ANON` | Login akun & terbitkan token (cookie web / body mobile) | `Body` | `400, 401, 429` | `KEDUANYA` |
| 7 | `POST` | `/api/v1/auth/refresh` | `ANON` | Rotasi token sesi (single-flight refresh) | `Body (mobile)` / Cookie | `400, 401, 429` | `KEDUANYA` |
| 8 | `POST` | `/api/v1/auth/logout` | `AUTH` | Cabut refresh token aktif & logout | `Body (mobile)` / Cookie | `400, 401` | `KEDUANYA` |
| 9 | `POST` | `/api/v1/auth/logout-all` | `AUTH` | Cabut seluruh sesi aktif akun (semua perangkat) | - | `401` | `KEDUANYA` |
| 10 | `POST` | `/api/v1/auth/forgot-password` | `ANON` | Permintaan link reset password via email | `Body` | `400, 429, 502` | `KEDUANYA` |
| 11 | `POST` | `/api/v1/auth/reset-password` | `ANON` | Setel ulang password menggunakan token link email | `Body` | `400, 429` | `KEDUANYA` |
| 12 | `POST` | `/api/v1/auth/change-password` | `AUTH` | Ganti password mandiri (wajib jika mustChangePassword) | `Body` | `400, 401` | `KEDUANYA` |
| 13 | `GET` | `/api/v1/auth/me` | `AUTH` | Ambil profil akun pengguna yang sedang login | - | `401` | `KEDUANYA` |
| 14 | `PATCH` | `/api/v1/auth/me` | `AUTH` | Perbarui data profil akun (nama, telepon, alamat) | `Body` | `400, 401` | `KEDUANYA` |
| 15 | `POST` | `/api/v1/auth/me/avatar` | `AUTH` | Unggah foto avatar pengguna (maks 5MB, format gambar) | `Body (multipart)` | `400, 401` | `KEDUANYA` |
| 16 | `GET` | `/api/v1/files/:kind/:id` | `ANON` / `AUTH` | Stream berkas privat menggunakan signed URL aman | `Params, Query` | `400, 401, 404` | `KEDUANYA` |
| 17 | `GET` | `/api/v1/outlets` | `ANON` | Ambil daftar cabang bengkel aktif (publik) | `Query` | - | `KEDUANYA` |
| 18 | `GET` | `/api/v1/outlets/:id` | `ANON` | Ambil detail cabang bengkel berdasarkan ID | `Params` | `400, 404` | `KEDUANYA` |
| 19 | `GET` | `/api/v1/outlets/:id/availability` | `ANON` | Cek ketersediaan slot reservasi pada tanggal tertentu | `Params, Query` | `400, 404, 429` | `KEDUANYA` |
| 20 | `GET` | `/api/v1/outlets/:id/reviews` | `ANON` | Ambil ulasan pelanggan publik cabang bengkel | `Params, Query` | `400, 404` | `KEDUANYA` |
| 21 | `GET` | `/api/v1/categories` | `ANON` | Ambil daftar kategori servis aktif (publik) | `Query` | - | `KEDUANYA` |
| 22 | `GET` | `/api/v1/services` | `ANON` | Ambil daftar paket servis bengkel aktif (publik) | `Query` | - | `KEDUANYA` |
| 23 | `GET` | `/api/v1/services/:id` | `ANON` | Ambil detail paket servis bengkel | `Params` | `400, 404` | `KEDUANYA` |
| 24 | `GET` | `/api/v1/spareparts` | `ANON` | Ambil daftar suku cadang aktif (katalog publik) | `Query` | - | `KEDUANYA` |
| 25 | `GET` | `/api/v1/vehicles` | `CUSTOMER` | Ambil daftar kendaraan milik pelanggan | `Query` | `401` | `MOBILE` |
| 26 | `POST` | `/api/v1/vehicles` | `CUSTOMER` | Tambah data kendaraan pelanggan baru | `Body` | `400, 401, 409` | `MOBILE` |
| 27 | `GET` | `/api/v1/vehicles/:id` | `CUSTOMER` | Ambil detail kendaraan milik pelanggan | `Params` | `400, 401, 404` | `MOBILE` |
| 28 | `PATCH` | `/api/v1/vehicles/:id` | `CUSTOMER` | Perbarui data kendaraan milik pelanggan | `Params, Body` | `400, 401, 404` | `MOBILE` |
| 29 | `DELETE` | `/api/v1/vehicles/:id` | `CUSTOMER` | Hapus kendaraan pelanggan (soft delete) | `Params` | `400, 401, 404, 409` | `MOBILE` |
| 30 | `GET` | `/api/v1/vehicles/:id/history` | `CUSTOMER` / `STAFF` | Ambil riwayat servis lengkap suatu kendaraan | `Params, Query` | `400, 401, 404` | `KEDUANYA` |
| 31 | `GET` | `/api/v1/vehicles/:id/reminders` | `CUSTOMER` / `STAFF` | Ambil jadwal pengingat servis suatu kendaraan | `Params, Query` | `400, 401, 404` | `KEDUANYA` |
| 32 | `GET` | `/api/v1/bookings` | `AUTH` | Ambil daftar booking (disaring sesuai role aktor) | `Query` | `401` | `KEDUANYA` |
| 33 | `POST` | `/api/v1/bookings` | `CUSTOMER` | Buat reservasi booking servis baru | `Body` | `400, 401, 409, 422` | `MOBILE` |
| 34 | `POST` | `/api/v1/bookings/check-in` | `STAFF` | Check-in pelanggan di bengkel via pemindaian QR Code | `Body` | `400, 401, 403, 409` | `KEDUANYA` |
| 35 | `GET` | `/api/v1/bookings/:id` | `AUTH` | Ambil detail booking (field disesuaikan role aktor) | `Params` | `400, 401, 404` | `KEDUANYA` |
| 36 | `POST` | `/api/v1/bookings/:id/cancel` | `CUSTOMER` / `ADMIN` | Batalkan booking (alasan wajib bila dibatalkan Admin) | `Params, Body` | `400, 401, 404, 409` | `KEDUANYA` |
| 37 | `GET` | `/api/v1/bookings/:id/qr` | `CUSTOMER` | Ambil payload QR Code check-in bertanda tangan HMAC | `Params` | `400, 401, 404` | `MOBILE` |
| 38 | `GET` | `/api/v1/bookings/:id/queue-position`| `CUSTOMER` | Pantau nomor dan estimasi posisi antrean pengerjaan | `Params` | `400, 401, 404` | `MOBILE` |
| 39 | `GET` | `/api/v1/bookings/:id/logs` | `AUTH` | Ambil riwayat log perubahan status booking | `Params` | `400, 401, 404` | `KEDUANYA` |
| 40 | `POST` | `/api/v1/bookings/:id/start` | `STAFF` | Mulai pengerjaan servis mobil (IN_PROGRESS) | `Params` | `400, 401, 403, 404, 409` | `KEDUANYA` |
| 41 | `POST` | `/api/v1/bookings/:id/assign` | `ADMIN` | Tugaskan mekanik tertentu pada booking | `Params, Body` | `400, 401, 403, 404, 409` | `WEB` |
| 42 | `POST` | `/api/v1/bookings/:id/items` | `STAFF` | Tambah rekomendasi item tambahan (sparepart/jasa) | `Params, Body` | `400, 401, 403, 404, 409` | `KEDUANYA` |
| 43 | `DELETE` | `/api/v1/bookings/:id/items/:itemId`| `STAFF` | Tarik/hapus item tambahan yang masih pending | `Params` | `400, 401, 403, 404, 409` | `KEDUANYA` |
| 44 | `POST` | `/api/v1/bookings/:id/approvals` | `CUSTOMER` / `ADMIN` | Persetujuan/penolakan batch item perbaikan tambahan | `Params, Body` | `400, 401, 403, 404, 409` | `KEDUANYA` |
| 45 | `GET` | `/api/v1/bookings/:id/photos` | `AUTH` | Ambil daftar foto inspeksi pengerjaan mobil | `Params` | `400, 401, 404` | `KEDUANYA` |
| 46 | `POST` | `/api/v1/bookings/:id/photos` | `STAFF` | Unggah foto bukti pengerjaan (BEFORE / AFTER) | `Params, Body (multipart)` | `400, 401, 403, 404, 409` | `KEDUANYA` |
| 47 | `DELETE` | `/api/v1/bookings/:id/photos/:photoId`| `STAFF` | Hapus foto inspeksi pengerjaan | `Params` | `400, 401, 403, 404` | `KEDUANYA` |
| 48 | `PATCH` | `/api/v1/bookings/:id/inspection` | `STAFF` | Simpan catatan teknis inspeksi & pembaruan odometer | `Params, Body` | `400, 401, 403, 404` | `KEDUANYA` |
| 49 | `POST` | `/api/v1/bookings/:id/ready` | `STAFF` | Tandai mobil telah selesai diservis & siap diambil | `Params` | `400, 401, 403, 404, 409` | `KEDUANYA` |
| 50 | `POST` | `/api/v1/bookings/:id/complete` | `ADMIN` | Selesaikan transaksi (wajib sudah lunas) | `Params` | `400, 401, 403, 404, 409` | `WEB` |
| 51 | `GET` | `/api/v1/bookings/:id/payments` | `AUTH` | Ambil riwayat pembayaran & transaksi booking | `Params` | `400, 401, 404` | `KEDUANYA` |
| 52 | `POST` | `/api/v1/bookings/:id/payments/midtrans`| `CUSTOMER` / `ADMIN` | Terbitkan token Snap pembayaran online Midtrans | `Params` | `400, 401, 404, 409, 429` | `KEDUANYA` |
| 53 | `POST` | `/api/v1/bookings/:id/payments/cash` | `ADMIN` | Catat pembayaran tunai kasir & lunasi booking | `Params` | `400, 401, 403, 404, 409` | `WEB` |
| 54 | `POST` | `/api/v1/bookings/:id/tips` | `CUSTOMER` | Berikan tip apresiasi mekanik via Midtrans Snap | `Params, Body` | `400, 401, 404, 409, 429` | `MOBILE` |
| 55 | `GET` | `/api/v1/bookings/:id/invoice.pdf` | `AUTH` | Unduh berkas PDF faktur resmi bengkel | `Params` | `400, 401, 404, 409` | `KEDUANYA` |
| 56 | `POST` | `/api/v1/bookings/:id/review` | `CUSTOMER` | Berikan rating 1-5 bintang & ulasan servis | `Params, Body` | `400, 401, 404, 409` | `MOBILE` |
| 57 | `POST` | `/api/v1/payments/midtrans/notification`| `ANON` | Webhook penerima status transaksi resmi Midtrans | `Body` | `400, 404, 409` | Sistem |
| 58 | `POST` | `/api/v1/payments/:orderId/sync` | `ADMIN` | Sinkronisasi manual status transaksi dari Midtrans API | `Params` | `400, 401, 403, 404` | `WEB` |
| 59 | `GET` | `/api/v1/notifications` | `AUTH` | Ambil daftar notifikasi milik pengguna login | `Query` | `401` | `KEDUANYA` |
| 60 | `GET` | `/api/v1/notifications/unread-count`| `AUTH` | Ambil jumlah notifikasi belum dibaca | - | `401` | `KEDUANYA` |
| 61 | `PATCH` | `/api/v1/notifications/:id/read` | `AUTH` | Tandai satu notifikasi sebagai telah dibaca | `Params` | `400, 401, 404` | `KEDUANYA` |
| 62 | `POST` | `/api/v1/notifications/read-all` | `AUTH` | Tandai seluruh notifikasi pengguna sebagai dibaca | - | `401` | `KEDUANYA` |
| 63 | `POST` | `/api/v1/notifications/devices` | `AUTH` | Daftarkan Expo Push Token perangkat mobile | `Body` | `400, 401` | `MOBILE` |
| 64 | `DELETE` | `/api/v1/notifications/devices` | `AUTH` | Hapus pendaftaran Expo Push Token (saat logout) | `Body` | `400, 401` | `MOBILE` |
| 65 | `GET` | `/api/v1/assistant/menu` | `CUSTOMER` | Ambil menu bantuan interaktif asisten bengkel | - | `401` | `MOBILE` |
| 66 | `POST` | `/api/v1/assistant/query` | `CUSTOMER` | Ajukan pertanyaan/instruksi ke asisten bengkel | `Body` | `400, 401` | `MOBILE` |
| 67 | `GET` | `/api/v1/staff/queue` | `STAFF` | Pantau antrean servis berjalan di cabang staf | `Query` | `401, 403` | `KEDUANYA` |
| 68 | `POST` | `/api/v1/staff/queue/claim-next` | `MECHANIC` | Klaim dan mulai pekerjaan unit paling depan antrean | - | `401, 403, 409` | `MOBILE` |
| 69 | `GET` | `/api/v1/staff/me/jobs` | `STAFF` | Ambil riwayat pengerjaan servis mekanik login | `Query` | `401, 403` | `KEDUANYA` |
| 70 | `GET` | `/api/v1/staff/me/reviews` | `STAFF` | Ambil ulasan dari pelanggan untuk mekanik login | `Query` | `401, 403` | `KEDUANYA` |
| 71 | `GET` | `/api/v1/staff/me/tips` | `STAFF` | Ambil riwayat tip yang diterima oleh mekanik | `Query` | `401, 403` | `KEDUANYA` |
| 72 | `GET` | `/api/v1/admin/users` | `ADMIN` | Ambil daftar seluruh pengguna & staf bengkel | `Query` | `401, 403` | `WEB` |
| 73 | `POST` | `/api/v1/admin/users` | `ADMIN` | Buat akun staf baru (Admin / Mekanik cabang) | `Body` | `400, 401, 403, 409` | `WEB` |
| 74 | `GET` | `/api/v1/admin/users/:id` | `ADMIN` | Ambil detail pengguna/staf berdasarkan ID | `Params` | `400, 401, 403, 404` | `WEB` |
| 75 | `PATCH` | `/api/v1/admin/users/:id` | `ADMIN` | Perbarui data profil staf atau cabang penugasan | `Params, Body` | `400, 401, 403, 404` | `WEB` |
| 76 | `PATCH` | `/api/v1/admin/users/:id/status` | `ADMIN` | Aktifkan/nonaktifkan akun (blokir login & cabut sesi) | `Params, Body` | `400, 401, 403, 404, 409` | `WEB` |
| 77 | `DELETE` | `/api/v1/admin/users/:id` | `ADMIN` | Hapus akun pengguna/staf (soft delete) | `Params` | `400, 401, 403, 404, 409` | `WEB` |
| 78 | `POST` | `/api/v1/admin/users/:id/restore` | `ADMIN` | Pulihkan akun pengguna/staf yang telah dihapus | `Params` | `400, 401, 403, 404` | `WEB` |
| 79 | `GET` | `/api/v1/admin/outlets` | `ADMIN` | Ambil daftar seluruh cabang bengkel (termasuk nonaktif) | `Query` | `401, 403` | `WEB` |
| 80 | `POST` | `/api/v1/admin/outlets` | `ADMIN` | Tambah cabang bengkel operasional baru | `Body` | `400, 401, 403` | `WEB` |
| 81 | `PATCH` | `/api/v1/admin/outlets/:id` | `ADMIN` | Perbarui jam kerja, kapasitas pit, dan alamat cabang | `Params, Body` | `400, 401, 403, 404` | `WEB` |
| 82 | `DELETE` | `/api/v1/admin/outlets/:id` | `ADMIN` | Hapus cabang bengkel (soft delete) | `Params` | `400, 401, 403, 404, 409` | `WEB` |
| 83 | `POST` | `/api/v1/admin/outlets/:id/restore` | `ADMIN` | Pulihkan cabang bengkel yang telah dihapus | `Params` | `400, 401, 403, 404` | `WEB` |
| 84 | `POST` | `/api/v1/admin/outlets/:id/closures`| `ADMIN` | Tambah tanggal libur/tutup khusus cabang | `Params, Body` | `400, 401, 403, 404, 409` | `WEB` |
| 85 | `DELETE` | `/api/v1/admin/outlets/:id/closures/:closureId`| `ADMIN` | Hapus tanggal libur/tutup khusus cabang | `Params` | `400, 401, 403, 404` | `WEB` |
| 86 | `GET` | `/api/v1/admin/categories` | `ADMIN` | Ambil master kategori servis bengkel | `Query` | `401, 403` | `WEB` |
| 87 | `POST` | `/api/v1/admin/categories` | `ADMIN` | Tambah master kategori servis baru | `Body` | `400, 401, 403` | `WEB` |
| 88 | `PATCH` | `/api/v1/admin/categories/:id` | `ADMIN` | Perbarui nama & deskripsi kategori servis | `Params, Body` | `400, 401, 403, 404` | `WEB` |
| 89 | `DELETE` | `/api/v1/admin/categories/:id` | `ADMIN` | Hapus kategori servis (soft delete) | `Params` | `400, 401, 403, 404, 409` | `WEB` |
| 90 | `POST` | `/api/v1/admin/categories/:id/restore`| `ADMIN` | Pulihkan kategori servis yang telah dihapus | `Params` | `400, 401, 403, 404` | `WEB` |
| 91 | `GET` | `/api/v1/admin/services` | `ADMIN` | Ambil master daftar layanan servis | `Query` | `401, 403` | `WEB` |
| 92 | `POST` | `/api/v1/admin/services` | `ADMIN` | Tambah master layanan servis baru | `Body` | `400, 401, 403` | `WEB` |
| 93 | `PATCH` | `/api/v1/admin/services/:id` | `ADMIN` | Perbarui harga, durasi pengerjaan, dan checklist servis | `Params, Body` | `400, 401, 403, 404` | `WEB` |
| 94 | `DELETE` | `/api/v1/admin/services/:id` | `ADMIN` | Hapus layanan servis (soft delete) | `Params` | `400, 401, 403, 404, 409` | `WEB` |
| 95 | `POST` | `/api/v1/admin/services/:id/restore`| `ADMIN` | Pulihkan layanan servis yang telah dihapus | `Params` | `400, 401, 403, 404` | `WEB` |
| 96 | `GET` | `/api/v1/admin/spareparts` | `ADMIN` | Ambil master daftar suku cadang bengkel | `Query` | `401, 403` | `WEB` |
| 97 | `POST` | `/api/v1/admin/spareparts` | `ADMIN` | Tambah suku cadang baru (SKU, nama, harga, stok) | `Body` | `400, 401, 403, 409` | `WEB` |
| 98 | `PATCH` | `/api/v1/admin/spareparts/:id` | `ADMIN` | Perbarui data suku cadang (harga, satuan, status) | `Params, Body` | `400, 401, 403, 404` | `WEB` |
| 99 | `DELETE` | `/api/v1/admin/spareparts/:id` | `ADMIN` | Hapus data suku cadang (soft delete) | `Params` | `400, 401, 403, 404, 409` | `WEB` |
| 100 | `POST` | `/api/v1/admin/spareparts/:id/restore`| `ADMIN` | Pulihkan suku cadang yang telah dihapus | `Params` | `400, 401, 403, 404` | `WEB` |
| 101 | `POST` | `/api/v1/admin/spareparts/:id/adjust-stock`| `ADMIN` | Sesuaikan stok fisik suku cadang secara manual | `Params, Body` | `400, 401, 403, 404, 409` | `WEB` |
| 102 | `PATCH` | `/api/v1/admin/reviews/:id/visibility`| `ADMIN` | Sembunyikan atau tampilkan ulasan pelanggan publik | `Params, Body` | `400, 401, 403, 404` | `WEB` |
| 103 | `GET` | `/api/v1/admin/audit-logs` | `ADMIN` | Ambil jejak audit log keamanan & perubahan sistem | `Query` | `401, 403` | `WEB` |
| 104 | `GET` | `/api/v1/admin/dashboard` | `ADMIN` | Ambil statistik ringkasan dashboard operasional | `Query` | `401, 403` | `WEB` |
| 105 | `GET` | `/api/v1/admin/reports/summary` | `ADMIN` | Ambil data ringkasan laporan performa & pendapatan | `Query` | `400, 401, 403` | `WEB` |
| 106 | `GET` | `/api/v1/admin/reports/export` | `ADMIN` | Ekspor laporan operasional ke CSV / XLSX / PDF | `Query` | `400, 401, 403` | `WEB` |

---

## 3. Verifikasi Sinkronisasi
- Jumlah endpoint di dokumen ini: **106**
- Jumlah endpoint di `src/routes/`: **106**
- Jumlah endpoint di `docs/openapi.json`: **106**
- Sinkronisasi: **100% Cocok (106 == 106 == 106)**.

