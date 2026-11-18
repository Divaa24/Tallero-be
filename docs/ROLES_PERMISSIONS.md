# TALLERO AUTO — MATRIKS PERAN & HAK AKSES (ROLES_PERMISSIONS.md)

Dokumen ini memetakan seluruh hak akses endpoint API terhadap 4 peran pengguna (`ANON`, `CUSTOMER`, `MECHANIC`, `ADMIN`), aturan pembatasan kepemilikan data (*ownership scoping*), dan penyensoran field per role pada **Tallero Auto**.

---

## 1. Aturan Kepemilikan & Pertahanan IDOR (404 vs 403)

Sistem backend Tallero Auto menerapkan dua lapis otorisasi yang ketat:
1. **Lapis 1 (Route Middleware)**:
   - Middleware `authenticate`: Memverifikasi keabsahan JWT, status akun aktif, `isVerified`, dan kecocokan `tokenVersion`.
   - Middleware `authorize(...roles)`: Memastikan role pengguna memiliki izin mengakses endpoint. Jika tidak berhak, server langsung mengembalikan **HTTP 403 FORBIDDEN**.
2. **Lapis 2 (Service Query Ownership Scoping)**:
   - Pada endpoint yang mengakses resource spesifik berdasarkan ID (mis. `/vehicles/:id`, `/bookings/:id`), kepemilikan di-scope langsung pada klausa query database:
     ```javascript
     const vehicle = await prisma.vehicle.findFirst({
       where: { id: vehicleId, userId: actor.id }
     });
     if (!vehicle) throw new NotFoundError("Data kendaraan tidak ditemukan");
     ```
   - **Pertahanan Anti-IDOR**: Jika pelanggan mencoba mengakses atau memanipulasi ID kendaraan atau booking milik orang lain, server selalu mengembalikan **HTTP 404 NOT_FOUND**, bukan 403. Hal ini mencegah penyerang melakukan *resource ID harvesting/enumeration*.

---

## 2. Batasan Lingkup Data Staf (`bookingScope(actor)`)

| Role | Lingkup Baca (*Read Scope*) | Lingkup Tulis (*Write Scope*) | Akses Data Pelanggan |
|:---|:---|:---|:---|
| **CUSTOMER** | Hanya booking & kendaraan miliknya sendiri (`customerId = actor.id`). | Buat booking baru, batalkan (sebelum batas cutoff), setujui item perbaikan, bayar, ulas. | Data miliknya sendiri. Tidak dapat melihat nomor telepon/email staf. |
| **MECHANIC** | Terbatas pada **outlet tempat ia ditugaskan** (`outletId = actor.outletId`). Dapat memantau antrean cabang dan pekerjaannya sendiri. | Check-in unit, klaim/mulai antrean, ajukan perbaikan tambahan, unggah foto bukti, tandai mobil siap diambil (`READY_FOR_PICKUP`). | **Dibatasi**: Di antrean global hanya melihat nama depan pelanggan dan tipe mobil. Nomor telepon lengkap hanya terlihat pada booking yang telah di-assign ke dirinya. |
| **ADMIN** | **Global lintas cabang**: Seluruh outlet, antrean, transaksi, laporan keuangan, dan data pengguna. | Akses penuh: assign mekanik, kasir pembayaran tunai, paksa selesai (`COMPLETED`), batalkan dengan alasan, kelola master data. | Akses penuh untuk kepentingan operasional dan audit bengkel. |

---

## 3. Matriks Hak Akses: 106 Endpoint × 4 Role

Keterangan Simbol:
- `✓` (Allow): Diizinkan (mengembalikan `200` atau `201`).
- `401`: Ditolak karena belum login / token tidak valid.
- `403`: Ditolak karena role pengguna tidak memiliki wewenang.
- `404*`: Diizinkan untuk data miliknya sendiri; menghasilkan `404` jika mencoba mengakses data pengguna lain (IDOR defense).

| No | Method & Path | ANON | CUSTOMER | MECHANIC | ADMIN | Keterangan & Catatan Otorisasi |
|:---|:---|:---:|:---:|:---:|:---:|:---|
| 1 | `GET /health` | ✓ | ✓ | ✓ | ✓ | Terbuka publik (Liveness probe) |
| 2 | `GET /ready` | ✓ | ✓ | ✓ | ✓ | Terbuka publik (Readiness probe) |
| 3 | `POST /auth/register` | ✓ | ✓ | ✓ | ✓ | Publik (hanya mendaftarkan role `CUSTOMER`) |
| 4 | `POST /auth/verify-otp` | ✓ | ✓ | ✓ | ✓ | Publik |
| 5 | `POST /auth/resend-otp` | ✓ | ✓ | ✓ | ✓ | Publik |
| 6 | `POST /auth/login` | ✓ | ✓ | ✓ | ✓ | Publik (semua role login di pintu yang sama) |
| 7 | `POST /auth/refresh` | ✓ | ✓ | ✓ | ✓ | Menggunakan cookie web atau body mobile |
| 8 | `POST /auth/logout` | 401 | ✓ | ✓ | ✓ | Wajib menyertakan sesi aktif |
| 9 | `POST /auth/logout-all` | 401 | ✓ | ✓ | ✓ | Mencabut seluruh sesi akun |
| 10 | `POST /auth/forgot-password` | ✓ | ✓ | ✓ | ✓ | Publik |
| 11 | `POST /auth/reset-password` | ✓ | ✓ | ✓ | ✓ | Publik |
| 12 | `POST /auth/change-password` | 401 | ✓ | ✓ | ✓ | Wajib bagi staf baru saat login perdana |
| 13 | `GET /auth/me` | 401 | ✓ | ✓ | ✓ | Profil pengguna login |
| 14 | `PATCH /auth/me` | 401 | ✓ | ✓ | ✓ | Update profil pengguna login |
| 15 | `POST /auth/me/avatar` | 401 | ✓ | ✓ | ✓ | Upload foto profil pengguna login |
| 16 | `GET /files/:kind/:id` | ✓ | ✓ | ✓ | ✓ | Diotentikasi oleh parameter `sig` & `exp` |
| 17 | `GET /outlets` | ✓ | ✓ | ✓ | ✓ | Publik |
| 18 | `GET /outlets/:id` | ✓ | ✓ | ✓ | ✓ | Publik |
| 19 | `GET /outlets/:id/availability` | ✓ | ✓ | ✓ | ✓ | Publik (grid slot reservasi) |
| 20 | `GET /outlets/:id/reviews` | ✓ | ✓ | ✓ | ✓ | Publik (ulasan tersensor nama depan) |
| 21 | `GET /categories` | ✓ | ✓ | ✓ | ✓ | Publik |
| 22 | `GET /services` | ✓ | ✓ | ✓ | ✓ | Publik |
| 23 | `GET /services/:id` | ✓ | ✓ | ✓ | ✓ | Publik |
| 24 | `GET /spareparts` | ✓ | ✓ | ✓ | ✓ | Publik (katalog harga eceran) |
| 25 | `GET /vehicles` | 401 | ✓ | 403 | 403 | Daftar kendaraan milik customer login |
| 26 | `POST /vehicles` | 401 | ✓ | 403 | 403 | Tambah kendaraan customer |
| 27 | `GET /vehicles/:id` | 401 | 404* | 403 | 403 | Hanya kendaraan milik customer login |
| 28 | `PATCH /vehicles/:id` | 401 | 404* | 403 | 403 | Hanya kendaraan milik customer login |
| 29 | `DELETE /vehicles/:id` | 401 | 404* | 403 | 403 | Soft delete kendaraan customer |
| 30 | `GET /vehicles/:id/history` | 401 | 404* | ✓ | ✓ | Pemilik mobil atau Staf bengkel |
| 31 | `GET /vehicles/:id/reminders` | 401 | 404* | ✓ | ✓ | Pemilik mobil atau Staf bengkel |
| 32 | `GET /bookings` | 401 | 404* | ✓ (cabang) | ✓ (global) | Daftar booking terfilter role |
| 33 | `POST /bookings` | 401 | ✓ | 403 | 403 | Customer membuat reservasi |
| 34 | `POST /bookings/check-in` | 401 | 403 | ✓ (cabang) | ✓ | Staf scan QR check-in di gerbang |
| 35 | `GET /bookings/:id` | 401 | 404* | 404* (cabang)| ✓ | Detail booking (field tersensor per role) |
| 36 | `POST /bookings/:id/cancel` | 401 | 404* | 403 | ✓ | Customer (sebelum cutoff) / Admin (alasan) |
| 37 | `GET /bookings/:id/qr` | 401 | 404* | 403 | 403 | Hanya customer pemilik booking |
| 38 | `GET /bookings/:id/queue-position`| 401 | 404* | 403 | 403 | Hanya customer pemilik booking |
| 39 | `GET /bookings/:id/logs` | 401 | 404* | 404* (cabang)| ✓ | Jejak log status booking |
| 40 | `POST /bookings/:id/start` | 401 | 403 | ✓ (penangan) | ✓ | Mulai servis mobil di pit |
| 41 | `POST /bookings/:id/assign` | 401 | 403 | 403 | ✓ | Khusus Admin menugaskan mekanik |
| 42 | `POST /bookings/:id/items` | 401 | 403 | ✓ (penangan) | ✓ | Tambah rekomendasi suku cadang/jasa |
| 43 | `DELETE /bookings/:id/items/:itemId`| 401 | 403 | ✓ (penangan) | ✓ | Tarik rekomendasi item pending |
| 44 | `POST /bookings/:id/approvals` | 401 | 404* | 403 | ✓ (note wajib) | Customer (pemilik) atau Admin via telepon |
| 45 | `GET /bookings/:id/photos` | 401 | 404* | 404* (cabang)| ✓ | Foto bukti pengerjaan |
| 46 | `POST /bookings/:id/photos` | 401 | 403 | ✓ (penangan) | ✓ | Unggah foto BEFORE / AFTER |
| 47 | `DELETE /bookings/:id/photos/:photoId`| 401 | 403 | ✓ (penangan) | ✓ | Hapus foto bukti pengerjaan |
| 48 | `PATCH /bookings/:id/inspection` | 401 | 403 | ✓ (penangan) | ✓ | Catatan inspeksi teknis mekanik |
| 49 | `POST /bookings/:id/ready` | 401 | 403 | ✓ (penangan) | ✓ | Tandai mobil siap diambil |
| 50 | `POST /bookings/:id/complete` | 401 | 403 | 403 | ✓ | Tutup transaksi bengkel (wajib lunas) |
| 51 | `GET /bookings/:id/payments` | 401 | 404* | 404* (cabang)| ✓ | Riwayat pembayaran booking |
| 52 | `POST /bookings/:id/payments/midtrans`| 401 | 404* | 403 | ✓ | Buat token Snap pembayaran tagihan |
| 53 | `POST /bookings/:id/payments/cash` | 401 | 403 | 403 | ✓ | Kasir Admin catat pembayaran tunai |
| 54 | `POST /bookings/:id/tips` | 401 | 404* | 403 | 403 | Customer memberi tip mekanik |
| 55 | `GET /bookings/:id/invoice.pdf` | 401 | 404* | 404* (cabang)| ✓ | Unduh faktur PDF resmi (wajib lunas) |
| 56 | `POST /bookings/:id/review` | 401 | 404* | 403 | 403 | Customer memberi rating & ulasan |
| 57 | `POST /payments/midtrans/notification`| ✓ | ✓ | ✓ | ✓ | Webhook publik Midtrans (verifikasi SHA-512)|
| 58 | `POST /payments/:orderId/sync` | 401 | 403 | 403 | ✓ | Sinkronisasi manual transaksi Midtrans |
| 59 | `GET /notifications` | 401 | ✓ | ✓ | ✓ | Notifikasi milik pengguna login |
| 60 | `GET /notifications/unread-count`| 401 | ✓ | ✓ | ✓ | Jumlah notifikasi belum dibaca |
| 61 | `PATCH /notifications/:id/read` | 401 | 404* | 404* | 404* | Tandai notifikasi dibaca |
| 62 | `POST /notifications/read-all` | 401 | ✓ | ✓ | ✓ | Tandai semua notifikasi dibaca |
| 63 | `POST /notifications/devices` | 401 | ✓ | ✓ | ✓ | Daftarkan Expo Push Token |
| 64 | `DELETE /notifications/devices` | 401 | ✓ | ✓ | ✓ | Hapus Expo Push Token saat logout |
| 65 | `GET /assistant/menu` | 401 | ✓ | 403 | 403 | Menu asisten bengkel |
| 66 | `POST /assistant/query` | 401 | ✓ | 403 | 403 | Tanya asisten bengkel |
| 67 | `GET /staff/queue` | 401 | 403 | ✓ (cabang) | ✓ (global) | Antrean berjalan di pit bengkel |
| 68 | `POST /staff/queue/claim-next` | 401 | 403 | ✓ (cabang) | 403 | Mekanik klaim unit terdepan |
| 69 | `GET /staff/me/jobs` | 401 | 403 | ✓ | ✓ | Riwayat pekerjaan mekanik login |
| 70 | `GET /staff/me/reviews` | 401 | 403 | ✓ | ✓ | Ulasan untuk mekanik login |
| 71 | `GET /staff/me/tips` | 401 | 403 | ✓ | ✓ | Riwayat tip mekanik login |
| 72 | `GET /admin/users` | 401 | 403 | 403 | ✓ | Kelola pengguna & staf bengkel |
| 73 | `POST /admin/users` | 401 | 403 | 403 | ✓ | Tambah akun staf (Admin/Mekanik) |
| 74 | `GET /admin/users/:id` | 401 | 403 | 403 | ✓ | Detail pengguna/staf |
| 75 | `PATCH /admin/users/:id` | 401 | 403 | 403 | ✓ | Edit profil staf atau cabang |
| 76 | `PATCH /admin/users/:id/status` | 401 | 403 | 403 | ✓ | Aktifkan/nonaktifkan akun staf |
| 77 | `DELETE /admin/users/:id` | 401 | 403 | 403 | ✓ | Soft delete staf |
| 78 | `POST /admin/users/:id/restore` | 401 | 403 | 403 | ✓ | Pulihkan staf terhapus |
| 79 | `GET /admin/outlets` | 401 | 403 | 403 | ✓ | Seluruh cabang (termasuk nonaktif) |
| 80 | `POST /admin/outlets` | 401 | 403 | 403 | ✓ | Tambah cabang bengkel |
| 81 | `PATCH /admin/outlets/:id` | 401 | 403 | 403 | ✓ | Edit konfigurasi jam & pit cabang |
| 82 | `DELETE /admin/outlets/:id` | 401 | 403 | 403 | ✓ | Soft delete cabang |
| 83 | `POST /admin/outlets/:id/restore`| 401 | 403 | 403 | ✓ | Pulihkan cabang terhapus |
| 84 | `POST /admin/outlets/:id/closures`| 401 | 403 | 403 | ✓ | Tambah jadwal libur khusus |
| 85 | `DELETE /admin/outlets/:id/closures/:closureId`| 401 | 403 | 403 | ✓ | Hapus jadwal libur khusus |
| 86 | `GET /admin/categories` | 401 | 403 | 403 | ✓ | Master kategori servis |
| 87 | `POST /admin/categories` | 401 | 403 | 403 | ✓ | Tambah kategori servis |
| 88 | `PATCH /admin/categories/:id` | 401 | 403 | 403 | ✓ | Edit kategori servis |
| 89 | `DELETE /admin/categories/:id` | 401 | 403 | 403 | ✓ | Soft delete kategori servis |
| 90 | `POST /admin/categories/:id/restore`| 401 | 403 | 403 | ✓ | Pulihkan kategori terhapus |
| 91 | `GET /admin/services` | 401 | 403 | 403 | ✓ | Master paket layanan servis |
| 92 | `POST /admin/services` | 401 | 403 | 403 | ✓ | Tambah paket layanan servis |
| 93 | `PATCH /admin/services/:id` | 401 | 403 | 403 | ✓ | Edit paket layanan servis |
| 94 | `DELETE /admin/services/:id` | 401 | 403 | 403 | ✓ | Soft delete layanan servis |
| 95 | `POST /admin/services/:id/restore`| 401 | 403 | 403 | ✓ | Pulihkan layanan terhapus |
| 96 | `GET /admin/spareparts` | 401 | 403 | 403 | ✓ | Master suku cadang & stok fisik |
| 97 | `POST /admin/spareparts` | 401 | 403 | 403 | ✓ | Tambah suku cadang baru |
| 98 | `PATCH /admin/spareparts/:id` | 401 | 403 | 403 | ✓ | Edit suku cadang |
| 99 | `DELETE /admin/spareparts/:id` | 401 | 403 | 403 | ✓ | Soft delete suku cadang |
| 100| `POST /admin/spareparts/:id/restore`| 401 | 403 | 403 | ✓ | Pulihkan suku cadang terhapus |
| 101| `POST /admin/spareparts/:id/adjust-stock`| 401 | 403 | 403 | ✓ | Stock opname manual |
| 102| `PATCH /admin/reviews/:id/visibility`| 401 | 403 | 403 | ✓ | Moderasi ulasan pelanggan |
| 103| `GET /admin/audit-logs` | 401 | 403 | 403 | ✓ | Jejak audit log perubahan data |
| 104| `GET /admin/dashboard` | 401 | 403 | 403 | ✓ | Ringkasan metrik eksekutif |
| 105| `GET /admin/reports/summary` | 401 | 403 | 403 | ✓ | Ringkasan analitik laporan |
| 106| `GET /admin/reports/export` | 401 | 403 | 403 | ✓ | Ekspor laporan ke CSV/XLSX/PDF |

---

## 4. Perlindungan Mandiri Akun Admin
Sesuai aturan AGENTS.md §5:
1. Administrator **tidak dapat menghapus, menonaktifkan, atau menurunkan role dirinya sendiri**.
2. Administrator **tidak dapat menghapus atau menonaktifkan satu-satunya akun Admin aktif terakhir** di sistem (mencegah *lockout* permanen bengkel).

