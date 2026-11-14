// ==============================================================================
// TALLERO AUTO — BUSINESS RULES & CONSTANTS
// Satu sumber kebenaran untuk seluruh aturan bisnis bengkel (AGENTS.md §8).
// ==============================================================================

export const RULES = Object.freeze({
  // Timezone dasar bengkel
  TIMEZONE: "Asia/Jakarta",

  // Booking & Slot Availability
  MIN_LEAD_MINUTES: 60, // Minimal jarak waktu booking dari sekarang
  MAX_ADVANCE_DAYS: 30, // Maksimal pemesanan di muka (hari)
  CANCEL_CUTOFF_MINUTES: 60, // Batas waktu customer membatalkan booking sebelum slot
  CHECKIN_EARLY_MINUTES: 60, // Diperbolehkan check-in sebelum scheduledAt (menit)
  NO_SHOW_GRACE_MINUTES: 60, // Toleransi no-show setelah slot berakhir (menit)
  MAX_ACTIVE_BOOKINGS_PER_CUSTOMER: 3, // Maksimal booking aktif per customer
  MAX_ACTIVE_JOBS_PER_MECHANIC: 1, // Mekanik hanya mengerjakan 1 mobil secara aktif

  // Foto & Lampiran
  MAX_PHOTOS_PER_TYPE: 10, // Maksimal 10 foto BEFORE dan 10 foto AFTER
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_IMAGE_DIMENSION_PX: 1920, // Maks sisi terpanjang WebP

  // Tip & Review
  TIP_MIN: 1000, // Minimal tip Rp 1.000
  TIP_MAX_PER_TRANSACTION: 500000, // Maksimal tip Rp 500.000 per transaksi
  TIP_WINDOW_DAYS: 7, // Periode boleh memberikan tip setelah servis (hari)
  REVIEW_WINDOW_DAYS: 30, // Periode boleh memberikan review setelah servis (hari)

  // Otentikasi, OTP & Keamanan
  OTP_TTL_MIN: 10, // Masa berlaku OTP (10 menit)
  OTP_MAX_ATTEMPTS: 5, // Maksimal 5 kali salah input OTP sebelum hangus
  OTP_RESEND_COOLDOWN_SEC: 60, // Cooldown kirim ulang OTP (60 detik)
  OTP_MAX_SENDS_PER_HOUR: 5, // Maksimal 5 kirim OTP per jam per user
  LOGIN_MAX_FAILS: 5, // Lockout akun setelah 5 kali gagal login berturut-turut
  LOCK_MINUTES: 15, // Durasi lockout akun (15 menit)
  BCRYPT_SALT_ROUNDS: 12, // Hashing cost untuk bcrypt

  // Tokens & URLs
  ACCESS_TTL: "15m", // JWT Access Token TTL
  ACCESS_TTL_SEC: 15 * 60, // 900 detik
  REFRESH_TTL_DAYS: 30, // Refresh Token TTL (30 hari)
  SIGNED_URL_TTL_SEC: 600, // Signed URL berkas privat (10 menit)
  PASSWORD_RESET_TTL_MIN: 30, // Reset password link TTL (30 menit)

  // Transaksi & Pembayaran
  PAYMENT_EXPIRY_MIN: 60, // Batas waktu pelunasan invoice Midtrans Snap (60 menit)

  // Reminder & Laporan
  REMINDER_LEAD_DAYS: 7, // H-7 reminder servis berkala
  REPORT_MAX_RANGE_DAYS: 366, // Rentang laporan maksimal 1 tahun
  LOW_STOCK_THRESHOLD: 5, // Ambang batas stok suku cadang menipis (<= 5)

  // Status booking yang dianggap masih aktif menahan entitas master
  ACTIVE_BOOKING_STATUSES: Object.freeze([
    "PENDING",
    "CHECKED_IN",
    "IN_PROGRESS",
    "WAITING_APPROVAL",
    "READY_FOR_PICKUP",
  ]),
});

export default RULES;
