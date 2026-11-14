# TALLERO AUTO — WORKFLOW & ARCHITECTURE FLOWS

Dokumentasi diagram visual arsitektur alur kerja bengkel **Tallero Auto** untuk tim **Web Admin (React/Vite)** dan **Mobile Apps (Expo/React Native)**.

---

## 1. Alur Perjalanan Pelanggan (Customer Journey)

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer (App)
    participant API as Backend API
    participant DB as PostgreSQL
    participant Mail as Gmail OAuth2
    participant Midtrans as Midtrans Snap

    Note over C,Mail: 1. Pendaftaran & Verifikasi
    C->>API: POST /api/v1/auth/register
    API->>DB: Buat user CUSTOMER (isVerified: false)
    API->>Mail: Kirim OTP 6-Digit (HMAC-SHA256, TTL 10 mnt)
    C->>API: POST /api/v1/auth/verify-otp {email, otp}
    API->>DB: Validasi HMAC OTP -> isVerified: true

    Note over C,DB: 2. Registrasi Kendaraan & Cek Ketersediaan
    C->>API: POST /api/v1/vehicles {plateNumber, brand, model, type}
    API->>DB: Simpan kendaraan (activePlate unique)
    C->>API: GET /api/v1/outlets/:id/availability?date=...
    API-->>C: Daftar slot waktu (AVAILABLE | LIMITED | FULL | CLOSED)

    Note over C,DB: 3. Reservasi Servis
    C->>API: POST /api/v1/bookings {outletId, vehicleId, scheduledAt, serviceIds}
    API->>DB: Lock outlet -> Validasi kapasitas -> Buat Booking (PENDING)
    API-->>C: Kode Booking (TLR-YYYYMMDD-XXXXXX)
    C->>API: GET /api/v1/bookings/:id/qr
    API-->>C: Payload QR bertanda tangan HMAC (TLR-XXXX.exp.sig)

    Note over C,Midtrans: 4. Persetujuan Tambahan & Pembayaran
    opt Mekanik Menemukan Kerusakan Tambahan
        API-->>C: Socket.IO event 'booking:approval_requested'
        C->>API: POST /api/v1/bookings/:id/approvals {decisions: [...]}
        API->>DB: Update status item -> Hitung ulang total booking
    end

    Note over C,Midtrans: 5. Pembayaran Online
    C->>API: POST /api/v1/bookings/:id/payments/midtrans
    API->>Midtrans: Request Snap Token
    Midtrans-->>API: snapToken & redirectUrl
    API-->>C: snapToken
    C->>Midtrans: Bayar via QRIS / VA / CC
```

---

## 2. Alur Operasional Staf Bengkel (Staff & Workshop Flow)

```mermaid
sequenceDiagram
    autonumber
    actor S as Staf Bengkel / Admin
    actor M as Mekanik
    participant API as Backend API
    participant DB as PostgreSQL
    participant WS as Socket.IO

    Note over S,API: 1. Kedatangan & Check-in QR
    S->>API: POST /api/v1/bookings/check-in {qrPayload, odometerKm}
    API->>API: Verifikasi HMAC QR Code & Jendela Waktu
    API->>DB: Lock outlet -> Alokasi queueNumber atomik -> CHECKED_IN
    API->>WS: Emit 'queue:updated' & 'booking:status_changed'

    Note over M,API: 2. Pengambilan Pekerjaan & Mulai Servis
    M->>API: GET /api/v1/staff/queue?outletId=...
    API-->>M: Daftar antrian (isNext: true untuk kepala antrian)
    M->>API: POST /api/v1/staff/queue/claim-next
    API->>DB: Validasi FIFO & MAX_ACTIVE_JOBS <= 2 -> IN_PROGRESS
    API->>DB: Potong stok sparepart awal (update bersyarat stock >= qty)
    API->>WS: Emit 'queue:updated'

    Note over M,API: 3. Foto Inspeksi & Item Tambahan
    M->>API: POST /api/v1/bookings/:id/photos (type: BEFORE, multipart)
    API->>API: Re-encode WebP via Sharp -> Simpan private storage
    opt Rekomendasi Perbaikan Tambahan
        M->>API: POST /api/v1/bookings/:id/items {type, id, qty, note}
        API->>DB: Buat item (PENDING_APPROVAL) -> WAITING_APPROVAL
        API->>WS: Emit 'booking:approval_requested' ke Customer
    end

    Note over M,API: 4. Penyelesaian Pengerjaan
    M->>API: POST /api/v1/bookings/:id/photos (type: AFTER, multipart)
    M->>API: POST /api/v1/bookings/:id/ready
    API->>DB: Status -> READY_FOR_PICKUP, readyAt: now()
    API->>WS: Emit 'booking:status_changed' (notifikasi ke customer)
```

---

## 3. State Machine Siklus Hidup Booking

Semua perubahan status booking wajib melalui mesin status terpusat dengan update bersyarat (`WHERE id = :id AND status = :fromStatus`):

```mermaid
stateDiagram-v2
    [*] --> PENDING: POST /bookings (Customer)
    
    PENDING --> CHECKED_IN: POST /bookings/check-in (Scan QR Staf)
    PENDING --> CANCELLED: POST /bookings/:id/cancel (Customer / Admin)
    PENDING --> NO_SHOW: Cron Job 21:00 WIB (Otomatis jika lewat batas waktu)

    CHECKED_IN --> IN_PROGRESS: POST /bookings/:id/start atau claim-next (Mekanik)
    CHECKED_IN --> CANCELLED: POST /bookings/:id/cancel (Admin)

    IN_PROGRESS --> WAITING_APPROVAL: POST /bookings/:id/items (Mekanik tambah pekerjaan)
    WAITING_APPROVAL --> IN_PROGRESS: POST /bookings/:id/approvals (Customer setuju/tolak)

    IN_PROGRESS --> READY_FOR_PICKUP: POST /bookings/:id/ready (Mekanik selesai)
    
    READY_FOR_PICKUP --> COMPLETED: POST /bookings/:id/complete (Admin setelah PAID)
    
    COMPLETED --> [*]
    CANCELLED --> [*]
    NO_SHOW --> [*]
```

---

## 4. Alur Pembayaran & Rekonsiliasi Webhook Midtrans

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    actor A as Admin (Kasir)
    participant API as Backend API
    participant DB as PostgreSQL
    participant Midtrans as Midtrans Engine

    alt Pembayaran Tunai (Cash di Kasir)
        A->>API: POST /api/v1/bookings/:id/payments/cash
        API->>DB: Simpan Payment(CASH, PAID) -> Booking(PAID)
        API->>DB: Catat AuditLog
    else Pembayaran Online (Midtrans Snap)
        C->>API: POST /api/v1/bookings/:id/payments/midtrans
        API->>Midtrans: Request Snap Token (nominal = booking.total)
        Midtrans-->>API: {snapToken, redirectUrl, orderId}
        API->>DB: Simpan Payment(MIDTRANS, PENDING)
        C->>Midtrans: Customer melakukan pembayaran
        
        Note over Midtrans,API: Webhook Callback Asinkron
        Midtrans->>API: POST /api/v1/payments/midtrans/notification
        API->>API: Verifikasi SHA-512 (orderId + statusCode + grossAmount + ServerKey)
        API->>Midtrans: Konfirmasi Ulang via Midtrans Status API
        API->>DB: Cocokkan gross_amount & Idempotency check
        alt Sukses (settlement / capture)
            API->>DB: Payment(PAID) -> Booking(PAID)
            API->>API: Emit Socket.IO 'payment:updated'
        else Kedaluwarsa / Dibatalkan
            API->>DB: Payment(EXPIRED / CANCELLED)
        end
        API-->>Midtrans: HTTP 200 OK
    end
```

---

## 5. Alur Antrian Harian & Row Locking

```mermaid
flowchart TD
    A["Customer Tiba di Bengkel"] --> B["Staf Scan QR Code Booking"]
    B --> C{"Verifikasi HMAC & Waktu"}
    C -- "Gagal" --> D["Tolak: 400 QR Expired / Invalid"]
    C -- "Lolos" --> E["Mulai Transaksi Database"]
    E --> F["Lock Row: SELECT id FROM outlets WHERE id = :id FOR UPDATE"]
    F --> G["Hitung MAX(queueNumber) hari ini di outlet tersebut"]
    G --> H["Alokasikan queueNumber = MAX + 1"]
    H --> I["Update Booking: CHECKED_IN, queueDate, checkedInAt"]
    I --> J["Commit Transaksi"]
    J --> K["Broadcast Socket.IO: 'queue:updated' ke ruang outlet"]
    K --> L["Mekanik Bebas Mengambil Kepala Antrian (FIFO)"]
```

---

## 6. Alur Autentikasi & Rotasi Sesi Token

```mermaid
sequenceDiagram
    autonumber
    actor Client as Web / Mobile
    participant Auth as Auth Middleware
    participant Service as Session Tokens Service
    participant DB as PostgreSQL

    Note over Client,DB: 1. Login & Penerbitan Token
    Client->>Service: POST /auth/login {email, password}
    Service->>DB: Verifikasi password & tokenVersion
    Service->>Service: Buat JWT Access Token (HS256, 15 mnt)
    Service->>Service: Buat Opaque Refresh Token 48-byte acak
    Service->>DB: Simpan SHA-256(refreshToken) dengan familyId baru
    Service-->>Client: {accessToken, refreshToken}

    Note over Client,DB: 2. Rotasi Refresh Token
    Client->>Service: POST /auth/refresh {refreshToken}
    Service->>DB: Cari record berdasarkan SHA-256(refreshToken)
    alt Token Sudah Pernah Digunakan (Reuse Detection!)
        Service->>DB: Cabut SELURUH token dalam familyId yang sama (Revocation)
        Service-->>Client: 401 UNAUTHORIZED (Sesi diretas, wajib login ulang)
    else Token Masih Valid & Belum Digunakan
        Service->>DB: Tandai token lama sebagai revoked (replacedById)
        Service->>Service: Terbitkan Access Token baru & Refresh Token baru
        Service->>DB: Simpan Refresh Token baru (familyId tetap)
        Service-->>Client: {accessToken, refreshToken baru}
    end
```

