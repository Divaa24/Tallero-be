# TALLERO AUTO — SPESIFIKASI MODEL DATA & ENUM (DATA_MODELS.md)

Dokumen ini mendefinisikan seluruh struktur model data respons, pemetaan enumerasi, format data khusus, dan penyensoran field berbasis hak akses (*role-based field redaction*) pada API **Tallero Auto**.

---

## 1. Format Tipe Data Primitif & Khusus

| Format Data | Standar & Representasi di API | Contoh Nilai | Aturan Validasi / Presentasi di Klien |
|:---|:---|:---|:---|
| **Nilai Uang** | Integer Rupiah (`Int`), tanpa desimal | `350000` (Rp 350.000) | Klien bertanggung jawab memformat menjadi string Rupiah (mis. `Intl.NumberFormat('id-ID')`). Dilarang mengirim nilai float. |
| **Waktu / Tanggal** | String ISO-8601 UTC dengan akhiran `Z` | `"2026-11-20T09:00:00.000Z"` | Disimpan & dikirim dalam UTC. UI mengonversi ke waktu lokal cabang (`Asia/Jakarta` / WIB). |
| **Tanggal Kalender** | String tanggal ISO `YYYY-MM-DD` | `"2026-11-20"` | Digunakan untuk filter tanggal, jadwal tutup cabang, dan tanggal antrean harian. |
| **Jam Operasional** | String 24 jam `HH:mm` | `"08:00"`, `"17:00"` | Digunakan pada konfigurasi jam buka dan tutup cabang bengkel. |
| **Nomor Telepon** | Format standar internasional E.164 | `"+6281234567890"` | Dinormalisasi di server diawali `+62`. Regex: `^\+628[1-9][0-9]{7,11}$`. |
| **Plat Nomor** | String huruf kapital tanpa spasi/tanda hubung | `"B1234XYZ"`, `"D9876AB"` | Regex: `^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$`. Disimpan dalam kolom `Vehicle.plateNumber`. |
| **Kode Booking** | Prefiks unik alfanumerik `TLR-YYYYMMDD-XXXXXX` | `"TLR-20261120-X8J2K1"` | Kode transaksi publik yang aman ditunjukkan kepada pelanggan dan staf. |
| **Payload QR Code** | Format bertanda tangan HMAC: `<kode>.<unix_exp>.<hmac>` | `"TLR-20261120-X8J2K1.1763630000.a1b2c3d4e5f67890"` | Dirender menjadi gambar QR Code oleh Mobile App pelanggan dan dipindai oleh kamera staf saat check-in. |
| **Paginasi** | Envelope objek `meta` | `{ "page": 1, "limit": 20, "total": 45, "totalPages": 3 }` | `page` default 1, `limit` default 20 (maksimal 100). |

---

## 2. Katalog Enumerasi Lengkap (Enums)

### 2.1. `Role`
Peran hak akses pengguna di dalam sistem bengkel:
- `ADMIN`: Administrator pusat bengkel dengan hak akses penuh lintas cabang (master data, kasir tunai, laporan, kelola staf).
- `MECHANIC`: Staf mekanik yang terikat pada cabang tertentu (`outletId`). Mengelola antrean servis, rekomendasi perbaikan, dan foto inspeksi.
- `CUSTOMER`: Pelanggan umum pemilik kendaraan. Hanya dapat melihat dan mengelola data miliknya sendiri.

### 2.2. `VehicleType`
Kategori jenis kendaraan bermotor:
- `CAR`: Mobil / Kendaraan roda empat.
- `MOTORCYCLE`: Sepeda motor / Kendaraan roda dua.

### 2.3. `BookingStatus`
Siklus hidup status reservasi dan pengerjaan servis:
- `PENDING`: Reservasi berhasil dibuat pelanggan, menunggu kedatangan di cabang bengkel.
- `CHECKED_IN`: Pelanggan tiba di bengkel, QR Code berhasil dipindai oleh staf, nomor antrean pit diterbitkan.
- `IN_PROGRESS`: Mobil sedang dikerjakan secara aktif di atas pit oleh mekanik penangan.
- `WAITING_APPROVAL`: Mekanik menemukan perbaikan/suku cadang tambahan; pengerjaan dijeda menunggu persetujuan pelanggan.
- `READY_FOR_PICKUP`: Servis fisik selesai, foto inspeksi lengkap, mobil siap diambil, menunggu pelunasan tagihan.
- `COMPLETED`: Pembayaran tagihan telah lunas, nomor faktur diterbitkan, kendaraan diserahkan ke pelanggan.
- `CANCELLED`: Booking dibatalkan oleh pelanggan (sebelum cutoff) atau dibatalkan oleh Admin dengan alasan tercatat.
- `NO_SHOW`: Pelanggan tidak hadir di bengkel melebihi batas toleransi 60 menit setelah jam slot berakhir.

### 2.4. `ItemType` & `ItemSource`
- **`ItemType`**:
  - `SERVICE`: Paket jasa / pengerjaan mekanik bengkel.
  - `SPAREPART`: Komponen fisik / suku cadang kendaraan.
- **`ItemSource`**:
  - `CUSTOMER_BOOKING`: Dipilih oleh pelanggan saat reservasi awal (otomatis disetujui / `APPROVED`).
  - `MECHANIC_ADDED`: Rekomendasi tambahan mekanik saat mobil dibongkar/diinspeksi.

### 2.5. `ApprovalStatus`
Status persetujuan item perbaikan tambahan:
- `PENDING_APPROVAL`: Menunggu keputusan persetujuan dari pelanggan.
- `APPROVED`: Disetujui oleh pelanggan (atau Admin atas nama pelanggan); biaya ditambahkan ke tagihan dan stok dipotong.
- `REJECTED`: Ditolak oleh pelanggan; item tidak ditagihkan ke pelanggan dan stok tidak dipotong.

### 2.6. `PhotoType`
Tipe foto bukti dokumentasi pengerjaan:
- `BEFORE`: Foto kondisi fisik komponen sebelum perbaikan / saat unit masuk bengkel.
- `AFTER`: Foto kondisi komponen setelah perbaikan selesai dilakukan.

### 2.7. `PaymentType`, `PaymentMethod`, & `PaymentStatus`
- **`PaymentType`**:
  - `INVOICE`: Pembayaran tagihan resmi servis bengkel (pendapatan bengkel).
  - `TIP`: Uang tip sukarela apresiasi mekanik (bukan pendapatan bengkel, 100% hak mekanik).
- **`PaymentMethod`**:
  - `MIDTRANS`: Pembayaran online otomatis melalui gerbang pembayaran Midtrans Snap (QRIS, VA, Kartu).
  - `CASH`: Pembayaran langsung secara tunai di meja kasir Admin.
- **`PaymentStatus`**:
  - `PENDING`: Menunggu pembayaran dari pelanggan.
  - `PAID`: Pembayaran berhasil diverifikasi resmi.
  - `FAILED`: Pembayaran ditolak oleh bank atau sistem fraud.
  - `EXPIRED`: Batas waktu pembayaran (60 menit) telah kedaluwarsa.
  - `CANCELLED`: Transaksi dibatalkan oleh sistem (mis. karena digantikan transaksi baru atau dibayar kasir).
  - `REFUNDED`: Transaksi dikembalikan.
  - `DUPLICATE`: Transaksi ganda yang berhasil setelah booking dinyatakan lunas (butuh penanganan refund manual oleh Admin).
- **`BookingPaymentStatus`**:
  - `UNPAID`: Tagihan servis belum dilunasi.
  - `PAID`: Tagihan servis telah lunas seluruhnya.

### 2.8. `NotificationType` & `ReminderStatus`
- **`NotificationType`**:
  - `BOOKING_STATUS`: Perubahan status pengerjaan reservasi bengkel.
  - `APPROVAL_REQUEST`: Pemberitahuan rekomendasi perbaikan tambahan yang butuh persetujuan.
  - `PAYMENT`: Konfirmasi keberhasilan pembayaran tagihan atau tip.
  - `SERVICE_REMINDER`: Pengingat servis berkala kendaraan.
  - `SYSTEM`: Pengumuman penting dari sistem operasional bengkel.
- **`ReminderStatus`**:
  - `SCHEDULED`: Pengingat terjadwal di masa depan.
  - `REMINDED`: Notifikasi H-7 telah dikirimkan ke pelanggan.
  - `DUE`: Servis telah mencapai tanggal jatuh tempo atau target kilometer odometer.
  - `DONE`: Servis telah dilakukan oleh pelanggan.
  - `CANCELLED`: Pengingat dibatalkan.

---

## 3. Struktur Objek Model Data Respons

### 3.1. Objek `User` (Profil Pengguna)
```json
{
  "id": 12,
  "name": "Budi Santoso",
  "email": "budi.santoso@gmail.com",
  "phone": "+6281234567890",
  "address": "Jl. Margonda Raya No. 45, Depok",
  "avatarUrl": "http://localhost:5000/api/v1/files/avatar/12?exp=1763630600&sig=...",
  "role": "CUSTOMER",
  "outletId": null,
  "isActive": true,
  "isVerified": true,
  "mustChangePassword": false,
  "createdAt": "2026-11-01T08:00:00.000Z"
}
```
> [!IMPORTANT]
> **Field Sensitif yang TIDAK PERNAH Keluar di API**:
> `passwordHash`, `otpHash`, `tokenHash`, `tokenVersion`, `failedLoginCount`, `lockedUntil`, `googleId`, `rawNotification`.

---

### 3.2. Objek `Outlet` (Cabang Bengkel)
```json
{
  "id": 1,
  "name": "Cabang Utama Margonda",
  "address": "Jl. Margonda Raya No. 120, Beji, Depok",
  "phone": "+622177889900",
  "latitude": -6.3686,
  "longitude": 106.8332,
  "openDays": [1, 2, 3, 4, 5, 6],
  "openTime": "08:00",
  "closeTime": "17:00",
  "slotMinutes": 60,
  "slotCapacity": 5,
  "timezone": "Asia/Jakarta",
  "isActive": true
}
```

---

### 3.3. Objek `Service` (Paket Servis)
```json
{
  "id": 1,
  "categoryId": 1,
  "name": "Tune Up & Pembersihan Ruang Bakar 3D",
  "description": "Pembersihan throttle body, kalibrasi ECU OBD2, dan pembersihan injektor",
  "price": 350000,
  "estimatedMinutes": 60,
  "vehicleType": "CAR",
  "reminderIntervalDays": 180,
  "reminderIntervalKm": 10000,
  "isActive": true,
  "category": {
    "id": 1,
    "name": "Perawatan Rutin"
  }
}
```

---

### 3.4. Objek `Sparepart` (Suku Cadang)
```json
{
  "id": 5,
  "sku": "FLT-OLI-TYT-01",
  "name": "Filter Oli Toyota Original",
  "price": 45000,
  "stock": 18,
  "unit": "PCS",
  "isActive": true
}
```

---

### 3.5. Objek `Vehicle` (Kendaraan)
```json
{
  "id": 4,
  "userId": 12,
  "plateNumber": "B1234XYZ",
  "brand": "Toyota",
  "model": "Avanza Veloz 1.5 AT",
  "type": "CAR",
  "year": 2022,
  "color": "Putih Mutiara",
  "lastOdometerKm": 42150
}
```

---

### 3.6. Objek `Booking` (Perbedaan Respons: List vs Detail & Customer vs Staff)

#### A. Tampilan List Booking (`GET /api/v1/bookings`)
```json
{
  "id": 101,
  "code": "TLR-20261120-X8J2K1",
  "status": "IN_PROGRESS",
  "paymentStatus": "UNPAID",
  "scheduledAt": "2026-11-20T02:00:00.000Z",
  "queueNumber": 3,
  "total": 395000,
  "outlet": {
    "id": 1,
    "name": "Cabang Utama Margonda"
  },
  "vehicle": {
    "id": 4,
    "plateNumber": "B1234XYZ",
    "brand": "Toyota",
    "model": "Avanza Veloz 1.5 AT"
  },
  "mechanic": {
    "id": 8,
    "name": "Agus Pratama"
  }
}
```

#### B. Tampilan Detail Booking Lengkap (`GET /api/v1/bookings/:id`)
```json
{
  "id": 101,
  "code": "TLR-20261120-X8J2K1",
  "status": "IN_PROGRESS",
  "paymentStatus": "UNPAID",
  "scheduledAt": "2026-11-20T02:00:00.000Z",
  "slotEndAt": "2026-11-20T03:00:00.000Z",
  "queueDate": "2026-11-20",
  "queueNumber": 3,
  "isLate": false,
  "checkedInAt": "2026-11-20T01:50:12.000Z",
  "startedAt": "2026-11-20T02:10:00.000Z",
  "readyAt": null,
  "completedAt": null,
  "odometerKm": 42150,
  "customerNotes": "Getaran halus pada pedal rem saat pengereman mendadak",
  "staffNotes": "Ketebalan kampas rem depan tersisa 2.5 mm",
  "total": 395000,
  "invoiceNumber": null,
  "outlet": {
    "id": 1,
    "name": "Cabang Utama Margonda",
    "address": "Jl. Margonda Raya No. 120, Beji, Depok",
    "phone": "+622177889900"
  },
  "vehicle": {
    "id": 4,
    "plateNumber": "B1234XYZ",
    "brand": "Toyota",
    "model": "Avanza Veloz 1.5 AT",
    "type": "CAR",
    "color": "Putih Mutiara"
  },
  "customer": {
    "id": 12,
    "name": "Budi Santoso",
    "phone": "+6281234567890"
  },
  "mechanic": {
    "id": 8,
    "name": "Agus Pratama",
    "averageRating": 4.9
  },
  "items": [
    {
      "id": 201,
      "type": "SERVICE",
      "serviceId": 1,
      "nameSnapshot": "Tune Up & Pembersihan Ruang Bakar 3D",
      "unitPrice": 350000,
      "quantity": 1,
      "subtotal": 350000,
      "source": "CUSTOMER_BOOKING",
      "approvalStatus": "APPROVED",
      "note": null
    },
    {
      "id": 202,
      "type": "SPAREPART",
      "sparepartId": 5,
      "nameSnapshot": "Filter Oli Toyota Original",
      "unitPrice": 45000,
      "quantity": 1,
      "subtotal": 45000,
      "source": "MECHANIC_ADDED",
      "approvalStatus": "APPROVED",
      "note": "Filter oli lama sudah jenuh dan berjelaga"
    }
  ]
}
```

> [!WARNING]
> **Penyensoran Field untuk Perlindungan Privasi (Privacy Redaction)**:
> 1. **Bagi Customer**: Data `mechanic` hanya menampilkan `name` dan `averageRating`. **Nomor telepon dan email mekanik tidak pernah dibocorkan ke customer**.
> 2. **Bagi Mekanik di Antrean Global**: Data pelanggan hanya menampilkan nama depan (`customer.firstName`) dan tipe mobil. Nomor telepon lengkap pelanggan hanya dapat dilihat oleh mekanik yang telah di-assign resmi menangani booking tersebut.

---

### 3.7. Objek `Payment` (Transaksi Pembayaran)
```json
{
  "id": 89,
  "bookingId": 101,
  "type": "INVOICE",
  "method": "MIDTRANS",
  "orderId": "TLR-20261120-X8J2K1-INV-1",
  "amount": 395000,
  "status": "PAID",
  "snapToken": "c1f7a290-b19e-4e3f-8468-b32876543210",
  "redirectUrl": "https://app.sandbox.midtrans.com/snap/v2/vtweb/c1f7a290...",
  "midtransPaymentType": "qris",
  "paidAt": "2026-11-20T03:45:10.000Z"
}
```

---

### 3.8. Objek `Notification` (Notifikasi Pengguna)
```json
{
  "id": 55,
  "userId": 12,
  "type": "APPROVAL_REQUEST",
  "title": "Rekomendasi Tambahan Perbaikan Mobil",
  "body": "Mekanik Agus merekomendasikan penggantian Filter Oli seharga Rp 45.000.",
  "data": {
    "bookingId": 101,
    "bookingCode": "TLR-20261120-X8J2K1",
    "screen": "BOOKING_APPROVAL"
  },
  "readAt": null,
  "createdAt": "2026-11-20T02:25:00.000Z"
}
```

---

### 3.9. Objek `Review` (Ulasan Pelanggan)
```json
{
  "id": 24,
  "bookingId": 101,
  "outletId": 1,
  "mechanicId": 8,
  "rating": 5,
  "comment": "Pelayanan sangat memuaskan, montir komunikatif dan pengerjaan cepat.",
  "customerName": "Budi",
  "createdAt": "2026-11-20T06:00:00.000Z"
}
```
*(Nama pelanggan di ulasan publik disamarkan hanya menampilkan nama depan).*

