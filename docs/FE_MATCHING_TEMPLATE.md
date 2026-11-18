# TALLERO AUTO — TEMPLATE PENCOCOKAN KONTRAK FE (FE_MATCHING_TEMPLATE.md)

Template resmi ini wajib diisi oleh tim **Frontend Web (React/Next.js)** dan **Mobile Apps (Expo/React Native)** selama proses integrasi antarmuka untuk memastikan keselarasan 100% antara implementasi layar di sisi klien dengan kontrak API Backend **Tallero Auto**.

---

## 1. Petunjuk Pengisian & Alur Kerja

1. **Waktu Pengisian**: Diisi per komponen layar segera setelah layar selesai dihubungkan dengan endpoint backend.
2. **Kesesuaian Tipe Data**:
   - Pastikan nilai uang integer Rupiah (tanpa desimal) ditangani dengan benar.
   - Pastikan tanggal UTC ISO dikonversi ke waktu lokal cabang (`Asia/Jakarta`).
   - Pastikan plat nomor mobil di-trim dan di-uppercase sebelum dikirim.
3. **Pencocokan Nilai Enumerasi**: Periksa tabel enum di bagian bawah. Nilai string di FE **wajib identik huruf besar-kecilnya (case-sensitive)** dengan nilai resmi di backend.
4. **Prosedur Melaporkan Ketidakcocokan**:
   - Jika field di FE berbeda dengan kontrak: **Perbaiki di sisi FE** agar mengikuti `docs/API.md`.
   - Jika ada kebutuhan field tambahan yang belum disediakan backend: Buat tiket permohonan fitur ke tim Backend dengan format tiket di bagian akhir dokumen ini.

---

## 2. Lembar Kerja Pencocokan Layar (Screen Matching Sheet)

*Salin dan isi baris tabel berikut untuk setiap layar yang Anda kembangkan:*

| No | Nama Layar / Komponen | Role Aktor | Endpoint yang Dipakai | Field yang Dikirim FE (Body/Query) | Field yang Dibaca FE (Data Respons) | Cocok? (Y/N) | Catatan / Kendala Integrasi |
|:---|:---|:---:|:---|:---|:---|:---:|:---|
| **Contoh** | *Login Page* | *ANON* | `POST /api/v1/auth/login` | `email, password` | `accessToken, user.id, user.role` | **Y** | *Header X-Client: web berhasil terpasang di Axios.* |
| 1 | Layar Registrasi | `ANON` | `POST /api/v1/auth/register` | | | | |
| 2 | Layar Verifikasi OTP | `ANON` | `POST /api/v1/auth/verify-otp` | | | | |
| 3 | Layar Login | `ANON` | `POST /api/v1/auth/login` | | | | |
| 4 | Layar Ganti Password | `AUTH` | `POST /api/v1/auth/change-password`| | | | |
| 5 | Profil Pengguna | `AUTH` | `GET /api/v1/auth/me`<br>`PATCH /api/v1/auth/me` | | | | |
| 6 | Beranda / Landing Page | `ANON` | `GET /api/v1/services`<br>`GET /api/v1/outlets` | | | | |
| 7 | Dashboard Pelanggan | `CUSTOMER` | `GET /api/v1/bookings`<br>`GET /api/v1/vehicles` | | | | |
| 8 | Cek Ketersediaan Slot | `ANON` | `GET /api/v1/outlets/:id/availability` | | | | |
| 9 | Buat Booking Baru | `CUSTOMER` | `POST /api/v1/bookings` | | | | |
| 10 | Garasi Mobil Pelanggan | `CUSTOMER` | `GET /api/v1/vehicles`<br>`POST /api/v1/vehicles` | | | | |
| 11 | Tiket QR Check-in | `CUSTOMER` | `GET /api/v1/bookings/:id/qr` | | | | |
| 12 | Pantauan Antrean Pit | `CUSTOMER` | `GET /api/v1/bookings/:id/queue-position`| | | | |
| 13 | Persetujuan Item Tambahan | `CUSTOMER` | `GET /api/v1/bookings/:id`<br>`POST /api/v1/bookings/:id/approvals` | | | | |
| 14 | Bayar Tagihan (Snap) | `CUSTOMER` | `POST /api/v1/bookings/:id/payments/midtrans` | | | | |
| 15 | Unduh Faktur PDF | `AUTH` | `GET /api/v1/bookings/:id/invoice.pdf` | | | | |
| 16 | Ulasan & Rating Servis | `CUSTOMER` | `POST /api/v1/bookings/:id/review` | | | | |
| 17 | Beri Tip Mekanik | `CUSTOMER` | `POST /api/v1/bookings/:id/tips` | | | | |
| 18 | Notifikasi Pelanggan | `CUSTOMER` | `GET /api/v1/notifications` | | | | |
| 19 | Asisten Bengkel | `CUSTOMER` | `POST /api/v1/assistant/query` | | | | |
| 20 | Antrean Pit Staf Cabang | `STAFF` | `GET /api/v1/staff/queue` | | | | |
| 21 | Scan QR Gerbang Bengkel | `STAFF` | `POST /api/v1/bookings/check-in` | | | | |
| 22 | Mulai Pengerjaan Mobil | `STAFF` | `POST /api/v1/bookings/:id/start` | | | | |
| 23 | Upload Foto BEFORE/AFTER | `STAFF` | `POST /api/v1/bookings/:id/photos` | | | | |
| 24 | Tambah Rekomendasi Item | `STAFF` | `POST /api/v1/bookings/:id/items` | | | | |
| 25 | Mobil Selesai Fisik | `STAFF` | `POST /api/v1/bookings/:id/ready` | | | | |
| 26 | Dashboard Eksekutif Admin| `ADMIN` | `GET /api/v1/admin/dashboard` | | | | |
| 27 | Kasir Pembayaran Tunai | `ADMIN` | `POST /api/v1/bookings/:id/payments/cash` | | | | |
| 28 | Tutup Transaksi Booking | `ADMIN` | `POST /api/v1/bookings/:id/complete` | | | | |
| 29 | Master Outlet Cabang | `ADMIN` | `GET /api/v1/admin/outlets`<br>`POST /api/v1/admin/outlets` | | | | |
| 30 | Master Katalog Servis | `ADMIN` | `GET /api/v1/admin/services`<br>`POST /api/v1/admin/services` | | | | |
| 31 | Master Suku Cadang | `ADMIN` | `GET /api/v1/admin/spareparts`<br>`POST /api/v1/admin/spareparts` | | | | |
| 32 | Kelola Akun Staf | `ADMIN` | `GET /api/v1/admin/users`<br>`POST /api/v1/admin/users` | | | | |
| 33 | Ekspor Laporan Excel/PDF | `ADMIN` | `GET /api/v1/admin/reports/export` | | | | |

---

## 3. Checklist Keselarasan Enumerasi (Enums Verification)

Nilai di bawah ini **harus tepat sama persis** dengan yang dideklarasikan di frontend:

### 3.1. Role Pengguna (`Role`)
| Nilai Resmi Backend | Deskripsi | Nilai Terpasang di FE | Status (Y/N) |
|:---|:---|:---|:---:|
| `"ADMIN"` | Administrator Pusat | | |
| `"MECHANIC"` | Mekanik Cabang | | |
| `"CUSTOMER"` | Pelanggan Bengkel | | |

### 3.2. Status Siklus Booking (`BookingStatus`)
| Nilai Resmi Backend | Deskripsi | Nilai Terpasang di FE | Status (Y/N) |
|:---|:---|:---|:---:|
| `"PENDING"` | Menunggu kedatangan pelanggan | | |
| `"CHECKED_IN"` | Tiba di bengkel / dalam antrean | | |
| `"IN_PROGRESS"` | Sedang dikerjakan di pit servis | | |
| `"WAITING_APPROVAL"` | Menunggu persetujuan pelanggan | | |
| `"READY_FOR_PICKUP"` | Servis fisik selesai, siap diambil | | |
| `"COMPLETED"` | Transaksi selesai dan lunas | | |
| `"CANCELLED"` | Booking dibatalkan | | |
| `"NO_SHOW"` | Pelanggan tidak hadir | | |

### 3.3. Status Pembayaran (`PaymentStatus` & `BookingPaymentStatus`)
| Nilai Resmi Backend | Deskripsi | Nilai Terpasang di FE | Status (Y/N) |
|:---|:---|:---|:---:|
| `"PENDING"` | Menunggu pembayaran | | |
| `"PAID"` | Pembayaran berhasil / lunas | | |
| `"FAILED"` | Pembayaran ditolak | | |
| `"EXPIRED"` | Waktu bayar kedaluwarsa | | |
| `"CANCELLED"` | Dibatalkan sistem | | |
| `"DUPLICATE"` | Transaksi ganda susulan | | |
| `"UNPAID"` | Status tagihan booking belum lunas | | |

### 3.4. Tipe Item & Status Persetujuan (`ItemType` & `ApprovalStatus`)
| Nilai Resmi Backend | Deskripsi | Nilai Terpasang di FE | Status (Y/N) |
|:---|:---|:---|:---:|
| `"SERVICE"` | Jasa perbaikan / tune up | | |
| `"SPAREPART"` | Komponen suku cadang fisik | | |
| `"APPROVED"` | Disetujui pelanggan | | |
| `"PENDING_APPROVAL"` | Menunggu keputusan pelanggan | | |
| `"REJECTED"` | Ditolak pelanggan | | |

---

## 4. Format Laporan Ketidakcocokan (Discrepancy Issue Ticket)

Jika Anda menemukan respon API yang tidak sesuai dengan kebutuhan tampilan UI, laporkan ke tim backend dengan format berikut:

```markdown
### [LAPORAN KETIDAKCOCOKAN KONTRAK FE-BE]
- **Layar / Komponen**: (mis. Garasi Mobil Pelanggan)
- **Role Pengguna**: CUSTOMER
- **Endpoint Terkait**: GET /api/v1/vehicles
- **Masalah yang Ditemukan**: 
  Response data tidak memuat field `color` kendaraan padahal di desain Figma dibutuhkan.
- **Payload Request yang Dikirim**: 
  (Lampirkan query params atau body JSON)
- **Respons Nyata yang Diterima**: 
  (Lampirkan cuplikan JSON dari inspect network browser)
- **Perilaku yang Diharapkan**: 
  Objek vehicle menyertakan field `color: string`.
```

