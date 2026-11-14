# TALLERO AUTO — API CONTRACT & CLIENT INTEGRATION GUIDE

Panduan integrasi resmi untuk tim **Frontend Web (React/Vite)** dan **Mobile Apps (Expo/React Native)**.

---

## 1. Konvensi Envelope Respons

Semua endpoint RESTful mengembalikan data terbungkus dalam format JSON standar:

### A. Respons Sukses (`HTTP 200 / 201`)
```json
{
  "success": true,
  "data": {
    "id": 101,
    "code": "TLR-20261120-ABC123",
    "status": "PENDING"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```
> Field `meta` hanya disertakan pada endpoint yang mengembalikan daftar item (*paginated list*).

### B. Respons Gagal (`HTTP 4xx / 5xx`)
```json
{
  "success": false,
  "error": {
    "code": "SLOT_FULL",
    "message": "Kapasitas slot pada jam tersebut sudah penuh",
    "details": null
  }
}
```

---

## 2. Kode Status HTTP & Kode Error Standar

| Status Code | `error.code` | Deskripsi / Penanganan di Client |
| :--- | :--- | :--- |
| **400** | `VALIDATION_ERROR` | Format body/query/params gagal divalidasi oleh Zod. Detail field ada di `error.details`. |
| **401** | `UNAUTHORIZED` | Token JWT tidak disertakan, kedaluwarsa, atau tanda tangan tidak valid. Arahkan ke login. |
| **401** | `TOKEN_REUSED` | Terdeteksi penggunaan ulang refresh token lama. Seluruh sesi dicabut. Wajib login ulang. |
| **403** | `FORBIDDEN` | Pengguna tidak memiliki hak akses (role) untuk resource ini. |
| **403** | `PASSWORD_CHANGE_REQUIRED` | Staf baru wajib mengganti password sementara melalui `POST /auth/change-password`. |
| **404** | `NOT_FOUND` | Resource tidak ada atau **milik pengguna lain** (IDOR prevention). |
| **404** | `BOOKING_NOT_FOUND` | Booking tidak ditemukan. |
| **409** | `INVALID_STATE_TRANSITION` | Status booking tidak valid untuk aksi yang diminta (State Machine violation). |
| **409** | `SLOT_FULL` | Kapasitas slot jam yang dipilih telah terisi penuh. |
| **409** | `STOCK_INSUFFICIENT` | Suku cadang tidak mencukupi untuk memulai pekerjaan. |
| **409** | `BOOKING_NOT_PAID` | Faktur PDF ditolak karena booking belum lunas. |
| **422** | `UNPROCESSABLE_ENTITY` | Pelanggaran aturan bisnis spesifik (mis. booking kendaraan yang sedang aktif servis). |
| **429** | `RATE_LIMIT_EXCEEDED` | Terlalu banyak request dalam jendela waktu tertentu. Tunggu beberapa saat. |
| **500** | `INTERNAL_ERROR` | Kesalahan internal server (detail teknis tidak dibocorkan ke client). |

---

## 3. Konvensi Pagination & Filtering

- Parameter Query:
  - `page`: Nomor halaman (integer, default `1`).
  - `limit`: Jumlah data per halaman (integer, default `20`, **maksimal `100`**).
  - `search`: Kata kunci pencarian (nama, plat, kode booking). Pencarian di server bersifat **case-insensitive**.
- Penanganan Tanggal:
  - Input query tanggal menggunakan format `YYYY-MM-DD` (mis. `from=2026-11-01&to=2026-11-13`).
  - Nilai tanggal dihitung berdasarkan zona waktu bengkel (`Asia/Jakarta`).

---

## 4. Realtime Socket.IO Events

Klien web dan mobile dapat terhubung ke server Socket.IO dengan menyertakan JWT token saat handshake:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: {
    token: `Bearer ${accessToken}`
  }
});

socket.on("connect", () => {
  console.log("Socket terhubung dengan id:", socket.id);
});
```

### Ruang (*Rooms*) Terisolasi:
- `user:{userId}`: Menerima notifikasi personal, perubahan status booking, dan permintaan approval.
- `outlet:{outletId}:staff`: Khusus staf mekanik di cabang tersebut untuk update antrian.
- `admin`: Khusus admin untuk update operasional global.

### Daftar Event dari Server ke Klien:

1. **`booking:status_changed`**
   Dipancarkan saat status pengerjaan booking berubah.
   ```json
   {
     "bookingId": 101,
     "code": "TLR-20261120-ABC123",
     "fromStatus": "CHECKED_IN",
     "toStatus": "IN_PROGRESS",
     "timestamp": "2026-11-20T09:15:00.000Z"
   }
   ```

2. **`booking:approval_requested`**
   Dipancarkan saat mekanik merekomendasikan item perbaikan/suku cadang tambahan.
   ```json
   {
     "bookingId": 101,
     "code": "TLR-20261120-ABC123",
     "itemsCount": 1,
     "message": "Ada pekerjaan tambahan yang memerlukan persetujuan Anda"
   }
   ```

3. **`queue:updated`**
   Dipancarkan saat terjadi check-in baru, pekerjaan diambil mekanik, atau selesai.
   ```json
   {
     "outletId": 1,
     "date": "2026-11-20"
   }
   ```

4. **`payment:updated`**
   Dipancarkan setelah pembayaran online Midtrans atau tunai kasir terkonfirmasi.
   ```json
   {
     "bookingId": 101,
     "orderId": "INV-TLR-20261120-ABC123",
     "status": "PAID",
     "amount": 250000
   }
   ```

5. **`notification:new`**
   Dipancarkan saat ada pengumuman, pengingat servis berkala, atau peringatan sistem.

---

## 5. Format QR Code Check-in

- Pelanggan mengambil payload QR melalui:
  `GET /api/v1/bookings/:id/qr`
- Payload berformat string 3 segmen:
  $$\text{Payload} = \langle\text{bookingCode}\rangle.\langle\text{expiresAtTimestamp}\rangle.\langle\text{hmacSignature}\rangle$$
  Contoh: `TLR-20261120-ABC123.1763630000.a1b2c3d4e5f67890`
- Klien mobile merender string ini menjadi visual QR Code (mis. menggunakan `react-native-qrcode-svg`).
- Staf bengkel melakukan scan QR dan mengirimkan payload ke:
  `POST /api/v1/bookings/check-in` dengan body:
  ```json
  {
    "qrPayload": "TLR-20261120-ABC123.1763630000.a1b2c3d4e5f67890",
    "odometerKm": 34500
  }
  ```

---

## 6. Penggunaan Signed URL Gambar & File Privat

Seluruh foto inspeksi kondisi kendaraan (`BookingPhoto`) dan avatar profil disimpan di penyimpanan privat server (bukan public CDN statis).

- Akses file dilindungi oleh signed URL berumur pendek:
  $$\text{URL} = \text{/api/v1/files/}\langle\text{kind}\rangle\text{/}\langle\text{id}\rangle\text{?exp=}\langle\text{unixTimestamp}\rangle\text{&sig=}\langle\text{hmacSignature}\rangle$$
- URL dibuat saat klien memanggil `GET /api/v1/bookings/:id/photos` atau `GET /api/v1/auth/me`.
- **Masa Berlaku Signed URL**: 15 menit (`RULES.SIGNED_URL_TTL_SECONDS` = 900 detik).
- **Penanganan di Client**:
  - Tampilkan URL langsung pada komponen `<Image source={{ uri: photo.signedUrl }} />`.
  - Jika signed URL telah kedaluwarsa (`HTTP 401 INVALID_SIGNATURE / EXPIRED`), panggil kembali endpoint detail booking untuk mendapatkan signed URL baru yang segar.

