# TALLERO AUTO — PANDUAN INTEGRASI REALTIME SOCKET.IO (REALTIME.md)

Dokumen ini menjadi rujukan teknis integrasi event realtime dua arah (*bi-directional WebSocket*) antara server Backend **Tallero Auto** dengan Klien Web (React/Next.js) dan Mobile (Expo/React Native).

---

## 1. Arsitektur Koneksi & Handshake Terautentikasi

Sesuai aturan keamanan **AGENTS.md §4.23**:
1. Server Socket.IO **tidak pernah melakukan broadcast global tanpa room** (`io.emit()` dilarang). Seluruh transmisi event ditargetkan secara presisi ke room privat terisolasi.
2. Setiap koneksi socket wajib melalui proses autentikasi JWT pada saat *handshake*.
3. Klien wajib menyertakan Access Token yang valid saat inisialisasi koneksi.

### Inisialisasi Koneksi Klien (Web & Mobile)
```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: {
    token: `Bearer ${accessToken}`
  },
  withCredentials: true,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});
```

---

## 2. Isolasi Room Server-Side

Begitu koneksi terotentikasi, server secara otomatis memasukkan socket pengguna ke dalam room berikut (tanpa perlu aksi `join` manual dari klien):

| Nama Room | Siapa yang Masuk | Jenis Event yang Diterima |
|:---|:---|:---|
| `user:{userId}` | Pengguna bersangkutan (`CUSTOMER`, `MECHANIC`, `ADMIN`) | Pembaruan status booking miliknya, notifikasi baru, permintaan persetujuan item perbaikan. |
| `outlet:{outletId}:staff` | Seluruh `MECHANIC` dan staf yang terikat pada cabang tersebut | Pembaruan antrean unit masuk, check-in mobil di gerbang, unit siap dikerjakan. |
| `admin` | Seluruh pengguna dengan role `ADMIN` | Seluruh pembaruan operasional, status booking, kasir pembayaran, dan antrean global. |

---

## 3. Katalog Event Realtime & Payload Nyata

### 3.1. Event `booking:status_changed`
Dipancarkan setiap kali terjadi perubahan status booking pada State Machine (mis. saat mobil check-in, mulai diservis, atau siap diambil).
- **Penerima Room**: `user:{customerId}`, `outlet:{outletId}:staff`, `admin`.
- **Payload Nyata**:
  ```json
  {
    "bookingId": 101,
    "code": "TLR-20261120-X8J2K1",
    "fromStatus": "CHECKED_IN",
    "toStatus": "IN_PROGRESS",
    "outletId": 1,
    "customerId": 12,
    "updatedAt": "2026-11-20T02:10:00.000Z"
  }
  ```
- **Tindakan Klien**:
  - Pelanggan: Ubah badge status stepper pengerjaan mobil dan tampilkan toast: *"Mobil Anda sedang mulai dikerjakan di Pit 2."*
  - Admin/Mekanik: Perbarui baris tabel booking operasional.

---

### 3.2. Event `booking:approval_requested`
Dipancarkan saat mekanik menemukan perbaikan atau suku cadang tambahan dan membutuhkan persetujuan pelanggan.
- **Penerima Room**: `user:{customerId}`, `admin`.
- **Payload Nyata**:
  ```json
  {
    "bookingId": 101,
    "code": "TLR-20261120-X8J2K1",
    "itemsCount": 2,
    "message": "Mekanik merekomendasikan perbaikan tambahan yang memerlukan persetujuan Anda"
  }
  ```
- **Tindakan Klien (Mobile)**:
  - Buka modal pop-up / navigasikan layar ke halaman persetujuan item: `GET /api/v1/bookings/:id`.

---

### 3.3. Event `queue:updated`
Dipancarkan saat nomor antrean bergerak (unit baru check-in, unit diklaim mekanik, atau unit selesai).
- **Penerima Room**: `outlet:{outletId}:staff`, `admin`, dan `user:{customerId}` yang unitnya berada di antrean.
- **Payload Nyata**:
  ```json
  {
    "outletId": 1,
    "timestamp": "2026-11-20T02:15:30.000Z"
  }
  ```
- **Tindakan Klien**:
  - Mekanik: Lakukan *refetch* data antrean: `GET /api/v1/staff/queue`.
  - Pelanggan: Perbarui estimasi posisi antrean: `GET /api/v1/bookings/:id/queue-position`.

---

### 3.4. Event `payment:updated`
Dipancarkan saat pembayaran tagihan servis (Midtrans atau kasir tunai) berhasil diverifikasi lunas.
- **Penerima Room**: `user:{customerId}`, `admin`.
- **Payload Nyata**:
  ```json
  {
    "bookingId": 101,
    "orderId": "TLR-20261120-X8J2K1-INV-1",
    "status": "PAID",
    "amount": 395000
  }
  ```
- **Tindakan Klien**:
  - Tutup pop-up Midtrans Snap jika masih terbuka, perbarui badge tagihan menjadi `"LUNAS"`, dan aktifkan tombol unduh faktur PDF.

---

### 3.5. Event `notification:new`
Dipancarkan saat ada notifikasi pengingat servis atau pesan pengumuman sistem baru.
- **Penerima Room**: `user:{userId}`.
- **Payload Nyata**:
  ```json
  {
    "id": 56,
    "type": "SERVICE_REMINDER",
    "title": "Jadwal Servis Berkala Mobil",
    "body": "Mobil Toyota Avanza (B1234XYZ) sudah mendekati jadwal ganti oli berkala.",
    "data": { "vehicleId": 4, "screen": "VEHICLE_REMINDERS" },
    "createdAt": "2026-11-20T01:00:00.000Z"
  }
  ```
- **Tindakan Klien**:
  - Tingkatkan counter badge lonceng notifikasi (`unreadCount++`) dan tampilkan notifikasi pop-up in-app.

---

## 4. Strategi Reconnect, Refetch, & Pembaruan Token Kedaluwarsa

### 4.1. Pembaruan Token saat Kedaluwarsa (`connect_error`)
Karena masa aktif Access Token adalah 15 menit, koneksi socket yang terputus mungkin gagal tersambung kembali jika token lama telah kedaluwarsa:

```javascript
socket.on("connect_error", async (err) => {
  // Jika server menolak koneksi karena token kedaluwarsa atau dicabut
  if (err.data?.code === "INVALID_TOKEN" || err.data?.code === "TOKEN_REVOKED") {
    try {
      // 1. Jalankan alur refresh token API
      const newAccessToken = await refreshAccessToken();
      
      // 2. Perbarui token pada properti auth socket
      socket.auth.token = `Bearer ${newAccessToken}`;
      
      // 3. Sambungkan kembali socket
      socket.connect();
    } catch (refreshError) {
      // Jika refresh gagal, alihkan ke login
      handleLogout();
    }
  }
});
```

---

### 4.2. Strategi Refetch Data (Tanpa Polling)
Klien tidak disarankan melakukan polling berkala menggunakan `setInterval`. Manfaatkan event socket untuk memicu *cache invalidation* pada pustaka state management klien (mis. **TanStack Query / SWR / RTK Query**):

```javascript
// Contoh integrasi TanStack Query (React Query)
import { useQueryClient } from '@tanstack/react-query';

export function useRealtimeBookingSync(bookingId) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleStatusChanged = (data) => {
      if (data.bookingId === bookingId) {
        // Otomatis refetch query detail booking
        queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      }
    };

    socket.on('booking:status_changed', handleStatusChanged);
    return () => socket.off('booking:status_changed', handleStatusChanged);
  }, [bookingId, queryClient]);
}
```

