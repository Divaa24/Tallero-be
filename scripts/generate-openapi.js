// ==============================================================================
// TALLERO AUTO — OPENAPI SPEC & POSTMAN COLLECTION GENERATOR (106 ENDPOINTS)
// Sesuai AGENTS.md §1 & §9 (OpenAPI dari Zod + Swagger UI + Postman auto-token)
// ==============================================================================

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// 1. Security Scheme (Bearer JWT)
const bearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Masukkan JWT Access Token (berlaku 15 menit). Format: Bearer <token>",
});

// Standard Envelope Models
const SuccessEnvelope = (dataSchema) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z
      .object({
        page: z.number().int().optional(),
        limit: z.number().int().optional(),
        total: z.number().int().optional(),
        totalPages: z.number().int().optional(),
      })
      .optional(),
  });

const ErrorEnvelope = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().openapi({ example: "VALIDATION_ERROR" }),
    message: z.string().openapi({ example: "Data masukan tidak valid" }),
    details: z.any().optional(),
  }),
});

const jsonResponses = (dataSchema, summary = "Sukses", successStatus = 200) => ({
  [successStatus]: {
    description: summary,
    content: {
      "application/json": {
        schema: SuccessEnvelope(dataSchema),
      },
    },
  },
  400: {
    description: "Validasi gagal / parameter keliru",
    content: { "application/json": { schema: ErrorEnvelope } },
  },
  401: {
    description: "Belum terautentikasi / Token kedaluwarsa",
    content: { "application/json": { schema: ErrorEnvelope } },
  },
  403: {
    description: "Akses ditolak (Role tidak berhak / Password change required)",
    content: { "application/json": { schema: ErrorEnvelope } },
  },
  404: {
    description: "Resource tidak ditemukan / Bukan milik user",
    content: { "application/json": { schema: ErrorEnvelope } },
  },
  409: {
    description: "Konflik state mesin / Stok habis / Slot penuh",
    content: { "application/json": { schema: ErrorEnvelope } },
  },
});

// Master endpoint definitions
export const ALL_ENDPOINTS = [
  // 1. SYSTEM
  {
    method: "get",
    path: "/health",
    tags: ["System"],
    summary: "Liveness probe service",
    auth: false,
    responses: jsonResponses(z.object({ status: z.string(), uptime: z.number() })),
  },
  {
    method: "get",
    path: "/ready",
    tags: ["System"],
    summary: "Readiness probe database connection",
    auth: false,
    responses: jsonResponses(z.object({ status: z.string(), database: z.string() })),
  },

  // 2. AUTH
  {
    method: "post",
    path: "/auth/register",
    tags: ["Auth"],
    summary: "Pendaftaran customer baru (hanya CUSTOMER)",
    auth: false,
    body: z.object({
      name: z.string().openapi({ example: "Budi Santoso" }),
      email: z.string().email().openapi({ example: "budi@tallero.test" }),
      password: z.string().min(8).openapi({ example: "CustomerTallero123!" }),
      phone: z.string().openapi({ example: "+6281234567890" }),
    }),
    responses: jsonResponses(z.object({ email: z.string() }), "Registrasi berhasil", 201),
  },
  {
    method: "post",
    path: "/auth/verify-otp",
    tags: ["Auth"],
    summary: "Verifikasi OTP 6 digit registrasi",
    auth: false,
    body: z.object({
      email: z.string().email().openapi({ example: "budi@tallero.test" }),
      otp: z.string().length(6).openapi({ example: "123456" }),
    }),
    responses: jsonResponses(z.object({ verified: z.boolean() }), "OTP valid"),
  },
  {
    method: "post",
    path: "/auth/resend-otp",
    tags: ["Auth"],
    summary: "Kirim ulang OTP registrasi (cooldown 60s)",
    auth: false,
    body: z.object({ email: z.string().email().openapi({ example: "budi@tallero.test" }) }),
    responses: jsonResponses(z.object({ sent: z.boolean() })),
  },
  {
    method: "post",
    path: "/auth/login",
    tags: ["Auth"],
    summary: "Login dengan email dan password",
    auth: false,
    body: z.object({
      email: z.string().email().openapi({ example: "admin@tallero.test" }),
      password: z.string().openapi({ example: "AdminTallero123!" }),
    }),
    responses: jsonResponses(
      z.object({
        accessToken: z.string(),
        refreshToken: z.string().optional(),
        user: z.object({ id: z.number(), name: z.string(), email: z.string(), role: z.string() }),
      }),
      "Login berhasil"
    ),
  },
  {
    method: "post",
    path: "/auth/refresh",
    tags: ["Auth"],
    summary: "Rotasi refresh token dan penerbitan access token baru",
    auth: false,
    body: z.object({ refreshToken: z.string().optional() }),
    responses: jsonResponses(z.object({ accessToken: z.string(), refreshToken: z.string().optional() })),
  },
  {
    method: "post",
    path: "/auth/logout",
    tags: ["Auth"],
    summary: "Logout sesi saat ini dan cabut refresh token",
    auth: true,
    responses: jsonResponses(z.object({ loggedOut: z.boolean() })),
  },
  {
    method: "post",
    path: "/auth/logout-all",
    tags: ["Auth"],
    summary: "Logout dari semua perangkat dan inkremen tokenVersion",
    auth: true,
    responses: jsonResponses(z.object({ loggedOutAll: z.boolean() })),
  },
  {
    method: "post",
    path: "/auth/forgot-password",
    tags: ["Auth"],
    summary: "Permintaan link reset password via email",
    auth: false,
    body: z.object({ email: z.string().email().openapi({ example: "budi@tallero.test" }) }),
    responses: jsonResponses(z.object({ sent: z.boolean() })),
  },
  {
    method: "post",
    path: "/auth/reset-password",
    tags: ["Auth"],
    summary: "Reset password menggunakan token acak email",
    auth: false,
    body: z.object({
      token: z.string().openapi({ example: "reset-token-hex" }),
      newPassword: z.string().min(8).openapi({ example: "PasswordBaru123!" }),
    }),
    responses: jsonResponses(z.object({ reset: z.boolean() })),
  },
  {
    method: "post",
    path: "/auth/change-password",
    tags: ["Auth"],
    summary: "Ganti password user aktif",
    auth: true,
    body: z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(8),
    }),
    responses: jsonResponses(z.object({ changed: z.boolean() })),
  },
  {
    method: "get",
    path: "/auth/me",
    tags: ["Auth"],
    summary: "Dapatkan profil user aktif saat ini",
    auth: true,
    responses: jsonResponses(z.object({ id: z.number(), name: z.string(), email: z.string(), role: z.string() })),
  },
  {
    method: "patch",
    path: "/auth/me",
    tags: ["Auth"],
    summary: "Perbarui profil nama dan telepon user aktif",
    auth: true,
    body: z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), name: z.string(), phone: z.string() })),
  },
  {
    method: "post",
    path: "/auth/me/avatar",
    tags: ["Auth"],
    summary: "Unggah avatar foto profil user",
    auth: true,
    responses: jsonResponses(z.object({ avatarUrl: z.string() })),
  },

  // 3. FILES
  {
    method: "get",
    path: "/files/{kind}/{id}",
    tags: ["Files"],
    summary: "Akses file privat melalui signed URL terverifikasi",
    auth: false,
    params: z.object({
      kind: z.enum(["avatars", "photos", "invoices"]),
      id: z.string(),
    }),
    responses: {
      200: { description: "Streaming file biner", content: { "*/*": {} } },
      403: { description: "Signature HMAC tidak cocok atau kedaluwarsa" },
      404: { description: "File tidak ditemukan" },
    },
  },

  // 4. PUBLIC OUTLETS
  {
    method: "get",
    path: "/outlets",
    tags: ["Outlets"],
    summary: "Daftar cabang outlet aktif",
    auth: false,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string(), address: z.string() }))),
  },
  {
    method: "get",
    path: "/outlets/{id}",
    tags: ["Outlets"],
    summary: "Detail outlet berdasarkan ID",
    auth: false,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), name: z.string(), address: z.string() })),
  },
  {
    method: "get",
    path: "/outlets/{id}/availability",
    tags: ["Outlets"],
    summary: "Cek ketersediaan slot waktu servis outlet",
    auth: false,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.array(z.object({ time: z.string(), status: z.string(), remaining: z.number() }))),
  },
  {
    method: "get",
    path: "/outlets/{id}/reviews",
    tags: ["Outlets"],
    summary: "Ulasan dan rating publik untuk cabang outlet",
    auth: false,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ averageRating: z.number(), total: z.number(), reviews: z.array(z.any()) })),
  },

  // 5. PUBLIC CATALOG
  {
    method: "get",
    path: "/categories",
    tags: ["Catalog"],
    summary: "Daftar kategori layanan aktif",
    auth: false,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string() }))),
  },
  {
    method: "get",
    path: "/services",
    tags: ["Catalog"],
    summary: "Daftar katalog layanan servis aktif",
    auth: false,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string(), price: z.number() }))),
  },
  {
    method: "get",
    path: "/services/{id}",
    tags: ["Catalog"],
    summary: "Detail layanan servis berdasarkan ID",
    auth: false,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), name: z.string(), price: z.number() })),
  },
  {
    method: "get",
    path: "/spareparts",
    tags: ["Spareparts"],
    summary: "Daftar sparepart yang tersedia untuk customer",
    auth: false,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string(), price: z.number() }))),
  },

  // 6. VEHICLES (CUSTOMER)
  {
    method: "get",
    path: "/vehicles",
    tags: ["Vehicles"],
    summary: "Daftar kendaraan milik customer aktif",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), plateNumber: z.string() }))),
  },
  {
    method: "post",
    path: "/vehicles",
    tags: ["Vehicles"],
    summary: "Mendaftarkan kendaraan baru customer",
    auth: true,
    body: z.object({
      plateNumber: z.string().openapi({ example: "B1234XYZ" }),
      brand: z.string().openapi({ example: "Toyota" }),
      model: z.string().openapi({ example: "Avanza" }),
      type: z.enum(["CAR", "MOTORCYCLE"]),
      year: z.number().int().openapi({ example: 2021 }),
      color: z.string().optional(),
      lastOdometerKm: z.number().int().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), plateNumber: z.string() }), "Kendaraan dibuat", 201),
  },
  {
    method: "get",
    path: "/vehicles/{id}",
    tags: ["Vehicles"],
    summary: "Detail kendaraan customer berdasarkan ID",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), plateNumber: z.string() })),
  },
  {
    method: "patch",
    path: "/vehicles/{id}",
    tags: ["Vehicles"],
    summary: "Perbarui data kendaraan customer",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({
      color: z.string().optional(),
      lastOdometerKm: z.number().int().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number() })),
  },
  {
    method: "delete",
    path: "/vehicles/{id}",
    tags: ["Vehicles"],
    summary: "Hapus (soft delete) kendaraan customer",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "get",
    path: "/vehicles/{id}/history",
    tags: ["Vehicles"],
    summary: "Riwayat seluruh servis selesai untuk kendaraan",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.array(z.object({ id: z.number(), date: z.string(), total: z.number() }))),
  },
  {
    method: "get",
    path: "/vehicles/{id}/reminders",
    tags: ["Vehicles"],
    summary: "Daftar pengingat servis rutin kendaraan",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.array(z.object({ id: z.number(), serviceName: z.string(), status: z.string() }))),
  },

  // 7. BOOKINGS & WORKSHOP OPERATIONS
  {
    method: "get",
    path: "/bookings",
    tags: ["Bookings"],
    summary: "Daftar riwayat dan antrian booking sesuai role",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), code: z.string(), status: z.string() }))),
  },
  {
    method: "post",
    path: "/bookings",
    tags: ["Bookings"],
    summary: "Membuat booking servis baru",
    auth: true,
    body: z.object({
      outletId: z.number().int().positive(),
      vehicleId: z.number().int().positive(),
      scheduledAt: z.string(),
      serviceIds: z.array(z.number().int()).min(1),
      sparepartIds: z.array(z.number().int()).optional(),
      customerNotes: z.string().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), code: z.string(), total: z.number() }), "Booking dibuat", 201),
  },
  {
    method: "post",
    path: "/bookings/check-in",
    tags: ["Bookings"],
    summary: "Check-in kendaraan di bengkel via QR scan (Staf)",
    auth: true,
    body: z.object({ qrPayload: z.string(), odometerKm: z.number().int().optional() }),
    responses: jsonResponses(z.object({ bookingId: z.number(), queueNumber: z.number() })),
  },
  {
    method: "get",
    path: "/bookings/{id}",
    tags: ["Bookings"],
    summary: "Detail booking lengkap sesuai role yang mengakses",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), code: z.string(), status: z.string() })),
  },
  {
    method: "post",
    path: "/bookings/{id}/cancel",
    tags: ["Bookings"],
    summary: "Batalkan booking sebelum masuk pengerjaan",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ reason: z.string().optional() }),
    responses: jsonResponses(z.object({ id: z.number(), status: z.literal("CANCELLED") })),
  },
  {
    method: "get",
    path: "/bookings/{id}/qr",
    tags: ["Bookings"],
    summary: "Dapatkan payload signed QR code untuk check-in bengkel",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ code: z.string(), qrPayload: z.string() })),
  },
  {
    method: "get",
    path: "/bookings/{id}/logs",
    tags: ["Bookings"],
    summary: "Riwayat audit transisi status booking",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.array(z.object({ fromStatus: z.string(), toStatus: z.string(), createdAt: z.string() }))),
  },
  {
    method: "get",
    path: "/bookings/{id}/queue-position",
    tags: ["Bookings"],
    summary: "Posisi nomor antrian dan estimasi waktu tunggu",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ queueNumber: z.number(), position: z.number() })),
  },
  {
    method: "post",
    path: "/bookings/{id}/assign",
    tags: ["Bookings"],
    summary: "Tugaskan mekanik penanggung jawab booking (Admin)",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ mechanicId: z.number().int().positive() }),
    responses: jsonResponses(z.object({ id: z.number(), mechanicId: z.number() })),
  },
  {
    method: "post",
    path: "/bookings/{id}/start",
    tags: ["Bookings"],
    summary: "Mulai pengerjaan servis fisik dan potong stok suku cadang",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), status: z.literal("IN_PROGRESS") })),
  },
  {
    method: "post",
    path: "/bookings/{id}/ready",
    tags: ["Bookings"],
    summary: "Tandai pengerjaan selesai dan kendaraan siap diambil",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), status: z.literal("READY_FOR_PICKUP") })),
  },
  {
    method: "post",
    path: "/bookings/{id}/complete",
    tags: ["Bookings"],
    summary: "Selesaikan booking (wajib lunas) dan picu reminder servis",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), status: z.literal("COMPLETED") })),
  },
  {
    method: "patch",
    path: "/bookings/{id}/inspection",
    tags: ["Bookings"],
    summary: "Simpan catatan inspeksi teknis awal/akhir mekanik",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ inspectionNotes: z.string() }),
    responses: jsonResponses(z.object({ id: z.number() })),
  },
  {
    method: "post",
    path: "/bookings/{id}/items",
    tags: ["Bookings"],
    summary: "Tambah usulan jasa/part tambahan saat servis berjalan (Staf)",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({
      type: z.enum(["SERVICE", "SPAREPART"]),
      serviceId: z.number().optional(),
      sparepartId: z.number().optional(),
      quantity: z.number().int().min(1),
      note: z.string().min(5),
    }),
    responses: jsonResponses(z.object({ id: z.number(), approvalStatus: z.literal("PENDING_APPROVAL") }), "Item diajukan", 201),
  },
  {
    method: "delete",
    path: "/bookings/{id}/items/{itemId}",
    tags: ["Bookings"],
    summary: "Tarik atau batalkan usulan item tambahan pending",
    auth: true,
    params: z.object({ id: z.coerce.number(), itemId: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "post",
    path: "/bookings/{id}/approvals",
    tags: ["Bookings"],
    summary: "Persetujuan / penolakan item tambahan oleh customer",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({
      decisions: z.array(z.object({
        itemId: z.number().int(),
        approved: z.boolean(),
        rejectReason: z.string().optional(),
      })),
      adminNote: z.string().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), total: z.number() })),
  },
  {
    method: "get",
    path: "/bookings/{id}/photos",
    tags: ["Bookings"],
    summary: "Daftar foto inspeksi sebelum dan sesudah servis",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.array(z.object({ id: z.number(), type: z.string(), signedUrl: z.string() }))),
  },
  {
    method: "post",
    path: "/bookings/{id}/photos",
    tags: ["Bookings"],
    summary: "Unggah foto bukti pekerjaan servis (BEFORE / AFTER)",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), type: z.string() }), "Foto diunggah", 201),
  },
  {
    method: "delete",
    path: "/bookings/{id}/photos/{photoId}",
    tags: ["Bookings"],
    summary: "Hapus foto inspeksi booking",
    auth: true,
    params: z.object({ id: z.coerce.number(), photoId: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "get",
    path: "/bookings/{id}/payments",
    tags: ["Bookings"],
    summary: "Riwayat seluruh tagihan dan pembayaran booking",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.array(z.object({ id: z.number(), amount: z.number(), status: z.string() }))),
  },
  {
    method: "post",
    path: "/bookings/{id}/payments/midtrans",
    tags: ["Bookings"],
    summary: "Buat sesi transaksi pembayaran online Midtrans Snap",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ orderId: z.string(), snapToken: z.string(), redirectUrl: z.string() })),
  },
  {
    method: "post",
    path: "/bookings/{id}/payments/cash",
    tags: ["Bookings"],
    summary: "Penerimaan pembayaran tunai di kasir bengkel (Admin)",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ notes: z.string().optional() }),
    responses: jsonResponses(z.object({ orderId: z.string(), status: z.literal("PAID") })),
  },
  {
    method: "post",
    path: "/bookings/{id}/tips",
    tags: ["Bookings"],
    summary: "Beri uang tip sukarela untuk teknisi mekanik via Midtrans",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ amount: z.number().int().min(10000).max(500000) }),
    responses: jsonResponses(z.object({ orderId: z.string(), snapToken: z.string() })),
  },
  {
    method: "get",
    path: "/bookings/{id}/invoice.pdf",
    tags: ["Bookings"],
    summary: "Unduh invoice resmi format PDF",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: { 200: { description: "Streaming berkas PDF invoice", content: { "application/pdf": {} } } },
  },
  {
    method: "post",
    path: "/bookings/{id}/review",
    tags: ["Bookings"],
    summary: "Berikan ulasan dan rating kepuasan servis bengkel",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ rating: z.number().int().min(1).max(5), comment: z.string().optional() }),
    responses: jsonResponses(z.object({ id: z.number(), rating: z.number() }), "Review tersimpan", 201),
  },

  // 8. PAYMENTS & MIDTRANS WEBHOOK
  {
    method: "post",
    path: "/payments/midtrans/notification",
    tags: ["Payments"],
    summary: "Webhook HTTP notifikasi resmi dari server Midtrans",
    auth: false,
    body: z.object({
      order_id: z.string(),
      status_code: z.string(),
      gross_amount: z.string(),
      signature_key: z.string(),
      transaction_status: z.string(),
    }),
    responses: jsonResponses(z.object({ status: z.string() })),
  },
  {
    method: "post",
    path: "/payments/{orderId}/sync",
    tags: ["Payments"],
    summary: "Sinkronisasi paksa status transaksi ke API Midtrans",
    auth: true,
    params: z.object({ orderId: z.string() }),
    responses: jsonResponses(z.object({ orderId: z.string(), status: z.string() })),
  },

  // 9. NOTIFICATIONS & DEVICES
  {
    method: "get",
    path: "/notifications",
    tags: ["Notifications"],
    summary: "Daftar notifikasi aktivitas pengguna",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), title: z.string(), body: z.string() }))),
  },
  {
    method: "get",
    path: "/notifications/unread-count",
    tags: ["Notifications"],
    summary: "Jumlah notifikasi yang belum dibaca",
    auth: true,
    responses: jsonResponses(z.object({ unreadCount: z.number() })),
  },
  {
    method: "patch",
    path: "/notifications/{id}/read",
    tags: ["Notifications"],
    summary: "Tandai satu notifikasi sebagai telah dibaca",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), read: z.boolean() })),
  },
  {
    method: "post",
    path: "/notifications/read-all",
    tags: ["Notifications"],
    summary: "Tandai seluruh notifikasi user sebagai telah dibaca",
    auth: true,
    responses: jsonResponses(z.object({ markedCount: z.number() })),
  },
  {
    method: "post",
    path: "/notifications/devices",
    tags: ["Notifications"],
    summary: "Daftarkan push token Expo dari perangkat mobile",
    auth: true,
    body: z.object({ expoPushToken: z.string(), platform: z.enum(["ios", "android"]) }),
    responses: jsonResponses(z.object({ registered: z.boolean() })),
  },
  {
    method: "delete",
    path: "/notifications/devices",
    tags: ["Notifications"],
    summary: "Hapus push token Expo saat logout",
    auth: true,
    body: z.object({ expoPushToken: z.string() }),
    responses: jsonResponses(z.object({ unregistered: z.boolean() })),
  },

  // 10. ASSISTANT
  {
    method: "post",
    path: "/assistant/query",
    tags: ["Assistant"],
    summary: "Tanya jawab AI asisten bengkel otomotif",
    auth: true,
    body: z.object({ message: z.string().min(2) }),
    responses: jsonResponses(z.object({ reply: z.string() })),
  },
  {
    method: "get",
    path: "/assistant/menu",
    tags: ["Assistant"],
    summary: "Daftar pertanyaan cepat / template menu asisten",
    auth: true,
    responses: jsonResponses(z.array(z.string())),
  },

  // 11. STAFF & MECHANICS
  {
    method: "get",
    path: "/staff/queue",
    tags: ["Staff"],
    summary: "Antrian kerja bengkel aktif pada outlet cabang staf",
    auth: true,
    responses: jsonResponses(z.object({ waiting: z.array(z.any()), inProgress: z.array(z.any()) })),
  },
  {
    method: "post",
    path: "/staff/queue/claim-next",
    tags: ["Staff"],
    summary: "Mekanik mengklaim antrian terdepan untuk dikerjakan",
    auth: true,
    responses: jsonResponses(z.object({ bookingId: z.number(), code: z.string() })),
  },
  {
    method: "get",
    path: "/staff/me/jobs",
    tags: ["Staff"],
    summary: "Riwayat seluruh pengerjaan servis mekanik bersangkutan",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), code: z.string() }))),
  },
  {
    method: "get",
    path: "/staff/me/reviews",
    tags: ["Staff"],
    summary: "Daftar ulasan customer terhadap pengerjaan mekanik ini",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), rating: z.number() }))),
  },
  {
    method: "get",
    path: "/staff/me/tips",
    tags: ["Staff"],
    summary: "Total dan riwayat penerimaan uang tip mekanik",
    auth: true,
    responses: jsonResponses(z.object({ totalTip: z.number(), items: z.array(z.any()) })),
  },

  // 12. ADMIN USERS
  {
    method: "get",
    path: "/admin/users",
    tags: ["Admin Users"],
    summary: "Daftar seluruh pengguna sistem (Customer, Staf, Admin)",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string(), role: z.string() }))),
  },
  {
    method: "post",
    path: "/admin/users",
    tags: ["Admin Users"],
    summary: "Buat akun staf baru oleh Admin (Mekanik / Admin)",
    auth: true,
    body: z.object({
      name: z.string(),
      email: z.string().email(),
      role: z.enum(["ADMIN", "MECHANIC"]),
      outletId: z.number().optional(),
      phone: z.string().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), temporaryPassword: z.string() }), "Staf dibuat", 201),
  },
  {
    method: "get",
    path: "/admin/users/{id}",
    tags: ["Admin Users"],
    summary: "Detail pengguna sistem oleh Admin",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), name: z.string(), email: z.string() })),
  },
  {
    method: "patch",
    path: "/admin/users/{id}",
    tags: ["Admin Users"],
    summary: "Perbarui profil atau role pengguna oleh Admin",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ name: z.string().optional(), phone: z.string().optional(), outletId: z.number().optional() }),
    responses: jsonResponses(z.object({ id: z.number() })),
  },
  {
    method: "patch",
    path: "/admin/users/{id}/status",
    tags: ["Admin Users"],
    summary: "Aktivasi atau penonaktifan akun pengguna",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ isActive: z.boolean() }),
    responses: jsonResponses(z.object({ id: z.number(), isActive: z.boolean() })),
  },
  {
    method: "delete",
    path: "/admin/users/{id}",
    tags: ["Admin Users"],
    summary: "Hapus (soft delete) pengguna sistem",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "post",
    path: "/admin/users/{id}/restore",
    tags: ["Admin Users"],
    summary: "Pulihkan pengguna yang pernah di-soft-delete",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), restored: z.boolean() })),
  },

  // 13. ADMIN OUTLETS
  {
    method: "get",
    path: "/admin/outlets",
    tags: ["Admin Outlets"],
    summary: "Daftar outlet lengkap untuk manajemen Admin",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string() }))),
  },
  {
    method: "post",
    path: "/admin/outlets",
    tags: ["Admin Outlets"],
    summary: "Tambah cabang outlet baru",
    auth: true,
    body: z.object({
      name: z.string(),
      address: z.string(),
      phone: z.string().optional(),
      managerName: z.string().optional(),
      latitude: z.number(),
      longitude: z.number(),
      openDays: z.array(z.number()),
      openTime: z.string(),
      closeTime: z.string(),
      slotMinutes: z.number(),
      slotCapacity: z.number(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), name: z.string() }), "Outlet dibuat", 201),
  },
  {
    method: "patch",
    path: "/admin/outlets/{id}",
    tags: ["Admin Outlets"],
    summary: "Perbarui informasi cabang outlet",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      managerName: z.string().optional(),
      slotCapacity: z.number().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number() })),
  },
  {
    method: "delete",
    path: "/admin/outlets/{id}",
    tags: ["Admin Outlets"],
    summary: "Soft delete outlet cabang",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "post",
    path: "/admin/outlets/{id}/restore",
    tags: ["Admin Outlets"],
    summary: "Pulihkan outlet yang di-soft-delete",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), restored: z.boolean() })),
  },
  {
    method: "post",
    path: "/admin/outlets/{id}/closures",
    tags: ["Admin Outlets"],
    summary: "Jadwalkan hari libur atau penutupan khusus outlet",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ date: z.string(), reason: z.string() }),
    responses: jsonResponses(z.object({ id: z.number(), date: z.string() }), "Penutupan dijadwalkan", 201),
  },
  {
    method: "delete",
    path: "/admin/outlets/{id}/closures/{closureId}",
    tags: ["Admin Outlets"],
    summary: "Batalkan hari libur penutupan outlet",
    auth: true,
    params: z.object({ id: z.coerce.number(), closureId: z.coerce.number() }),
    responses: jsonResponses(z.object({ deleted: z.boolean() })),
  },

  // 14. ADMIN CATEGORIES
  {
    method: "get",
    path: "/admin/categories",
    tags: ["Admin Catalog"],
    summary: "Daftar seluruh kategori jasa untuk Admin",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string() }))),
  },
  {
    method: "post",
    path: "/admin/categories",
    tags: ["Admin Catalog"],
    summary: "Buat kategori jasa servis baru",
    auth: true,
    body: z.object({ name: z.string(), description: z.string().optional() }),
    responses: jsonResponses(z.object({ id: z.number(), name: z.string() }), "Kategori dibuat", 201),
  },
  {
    method: "patch",
    path: "/admin/categories/{id}",
    tags: ["Admin Catalog"],
    summary: "Perbarui nama dan deskripsi kategori",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ name: z.string().optional() }),
    responses: jsonResponses(z.object({ id: z.number() })),
  },
  {
    method: "delete",
    path: "/admin/categories/{id}",
    tags: ["Admin Catalog"],
    summary: "Soft delete kategori",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "post",
    path: "/admin/categories/{id}/restore",
    tags: ["Admin Catalog"],
    summary: "Pulihkan kategori terhapus",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), restored: z.boolean() })),
  },

  // 15. ADMIN SERVICES
  {
    method: "get",
    path: "/admin/services",
    tags: ["Admin Catalog"],
    summary: "Daftar seluruh layanan servis untuk Admin",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), name: z.string(), price: z.number() }))),
  },
  {
    method: "post",
    path: "/admin/services",
    tags: ["Admin Catalog"],
    summary: "Tambah layanan servis baru ke katalog",
    auth: true,
    body: z.object({
      categoryId: z.number().int().positive(),
      name: z.string(),
      description: z.string().optional(),
      badge: z.string().optional(),
      imageUrl: z.string().optional(),
      checklist: z.array(z.string()).optional(),
      price: z.number().int().positive(),
      estimatedMinutes: z.number().int().positive(),
      vehicleType: z.enum(["CAR", "MOTORCYCLE"]).optional(),
      reminderIntervalDays: z.number().optional(),
      reminderIntervalKm: z.number().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), name: z.string() }), "Layanan dibuat", 201),
  },
  {
    method: "patch",
    path: "/admin/services/{id}",
    tags: ["Admin Catalog"],
    summary: "Ubah harga atau spesifikasi layanan servis",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      badge: z.string().optional(),
      imageUrl: z.string().optional(),
      checklist: z.array(z.string()).optional(),
      price: z.number().int().optional(),
      estimatedMinutes: z.number().int().optional(),
    }),
    responses: jsonResponses(z.object({ id: z.number() })),
  },
  {
    method: "delete",
    path: "/admin/services/{id}",
    tags: ["Admin Catalog"],
    summary: "Soft delete layanan servis",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "post",
    path: "/admin/services/{id}/restore",
    tags: ["Admin Catalog"],
    summary: "Pulihkan layanan servis",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), restored: z.boolean() })),
  },

  // 16. ADMIN SPAREPARTS
  {
    method: "get",
    path: "/admin/spareparts",
    tags: ["Admin Spareparts"],
    summary: "Daftar inventori sparepart untuk manajemen gudang",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), sku: z.string(), stock: z.number() }))),
  },
  {
    method: "post",
    path: "/admin/spareparts",
    tags: ["Admin Spareparts"],
    summary: "Tambah master data sparepart baru",
    auth: true,
    body: z.object({
      sku: z.string(),
      name: z.string(),
      price: z.number().int().positive(),
      stock: z.number().int().min(0),
      unit: z.string(),
    }),
    responses: jsonResponses(z.object({ id: z.number(), sku: z.string() }), "Sparepart dibuat", 201),
  },
  {
    method: "patch",
    path: "/admin/spareparts/{id}",
    tags: ["Admin Spareparts"],
    summary: "Perbarui informasi dan harga suku cadang",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ price: z.number().int().optional(), name: z.string().optional() }),
    responses: jsonResponses(z.object({ id: z.number() })),
  },
  {
    method: "delete",
    path: "/admin/spareparts/{id}",
    tags: ["Admin Spareparts"],
    summary: "Soft delete sparepart",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  {
    method: "post",
    path: "/admin/spareparts/{id}/restore",
    tags: ["Admin Spareparts"],
    summary: "Pulihkan data sparepart",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    responses: jsonResponses(z.object({ id: z.number(), restored: z.boolean() })),
  },
  {
    method: "post",
    path: "/admin/spareparts/{id}/adjust-stock",
    tags: ["Admin Spareparts"],
    summary: "Penyesuaian stok sparepart (opname) dengan audit log",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ delta: z.number().int(), reason: z.string().min(5) }),
    responses: jsonResponses(z.object({ id: z.number(), newStock: z.number() })),
  },

  // 17. ADMIN REVIEWS
  {
    method: "patch",
    path: "/admin/reviews/{id}/visibility",
    tags: ["Admin Reviews"],
    summary: "Moderasi visibilitas ulasan customer (sembunyikan / tampilkan)",
    auth: true,
    params: z.object({ id: z.coerce.number() }),
    body: z.object({ isHidden: z.boolean(), reason: z.string().optional() }),
    responses: jsonResponses(z.object({ id: z.number(), isHidden: z.boolean() })),
  },

  // 18. ADMIN AUDIT LOGS
  {
    method: "get",
    path: "/admin/audit-logs",
    tags: ["Admin Audit"],
    summary: "Daftar riwayat audit log seluruh aksi admin dan sistem",
    auth: true,
    responses: jsonResponses(z.array(z.object({ id: z.number(), action: z.string(), actorId: z.number() }))),
  },

  // 19. ADMIN DASHBOARD & REPORTS
  {
    method: "get",
    path: "/admin/dashboard",
    tags: ["Admin Analytics"],
    summary: "Metrik ringkasan dashboard real-time bengkel",
    auth: true,
    responses: jsonResponses(z.object({ todayBookings: z.number(), revenue: z.number() })),
  },
  {
    method: "get",
    path: "/admin/reports/summary",
    tags: ["Admin Analytics"],
    summary: "Laporan rekapitulasi performa bisnis bengkel",
    auth: true,
    responses: jsonResponses(z.object({ summary: z.any() })),
  },
  {
    method: "get",
    path: "/admin/reports/export",
    tags: ["Admin Analytics"],
    summary: "Ekspor laporan ke format CSV / XLSX",
    auth: true,
    responses: {
      200: { description: "Unduhan file laporan CSV atau Excel", content: { "*/*": {} } },
    },
  },
];

// Daftarkan semua 106 endpoint ke OpenAPI Registry
for (const ep of ALL_ENDPOINTS) {
  const reqObj = {};
  if (ep.params) reqObj.params = ep.params;
  if (ep.query) reqObj.query = ep.query;
  if (ep.body) {
    reqObj.body = {
      content: {
        "application/json": {
          schema: ep.body,
        },
      },
    };
  }

  const def = {
    method: ep.method,
    path: ep.path,
    tags: ep.tags,
    summary: ep.summary,
    responses: ep.responses,
  };
  if (Object.keys(reqObj).length > 0) {
    def.request = reqObj;
  }
  if (ep.auth) {
    def.security = [{ [bearerAuth.name]: [] }];
  }

  registry.registerPath(def);
}

export const generateOpenApiSpec = () => {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Tallero Auto — Bengkel Management System API",
      version: "1.0.0",
      description:
        "Dokumentasi resmi RESTful API Bengkel Mobil & Motor Tallero Auto. Dibangun menggunakan Express 5 ESM, Zod, PostgreSQL, dan Prisma.",
      contact: {
        name: "Tim Pengembang Backend Tallero Auto",
        email: "dev@tallero.test",
      },
    },
    servers: [
      {
        url: "/api/v1",
        description: "API Base URL (v1)",
      },
    ],
  });
};

export const exportFiles = () => {
  const openapiSpec = generateOpenApiSpec();
  const docsDir = path.resolve(process.cwd(), "docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  // 1. docs/openapi.json
  const openApiPath = path.join(docsDir, "openapi.json");
  fs.writeFileSync(openApiPath, JSON.stringify(openapiSpec, null, 2), "utf8");
  console.log(`✅ OpenAPI Spec (106 endpoints) berhasil diekspor ke: ${openApiPath}`);

  // 2. Postman Collection
  // Buat grup folder berdasarkan Tag
  const foldersMap = new Map();

  for (const ep of ALL_ENDPOINTS) {
    const tagName = ep.tags[0] || "General";
    if (!foldersMap.has(tagName)) {
      foldersMap.set(tagName, []);
    }

    const segments = ep.path.split("/").filter(Boolean);
    const postmanPath = segments.map((seg) => {
      if (seg.startsWith("{") && seg.endsWith("}")) {
        return `:${seg.slice(1, -1)}`;
      }
      return seg;
    });

    const item = {
      name: `[${ep.method.toUpperCase()}] ${ep.path} - ${ep.summary}`,
      request: {
        method: ep.method.toUpperCase(),
        header: [{ key: "Content-Type", value: "application/json" }],
        url: {
          raw: `{{baseUrl}}${ep.path.replace(/\{(\w+)\}/g, ":$1")}`,
          host: ["{{baseUrl}}"],
          path: postmanPath,
        },
        description: ep.summary,
      },
    };

    if (ep.method === "post" && ep.path === "/auth/login") {
      item.event = [
        {
          listen: "test",
          script: {
            exec: [
              "if (pm.response.code === 200) {",
              "    var jsonData = pm.response.json();",
              "    if (jsonData.data && jsonData.data.accessToken) {",
              "        pm.environment.set('accessToken', jsonData.data.accessToken);",
              "        console.log('AccessToken disimpan ke environment: ' + jsonData.data.accessToken);",
              "    }",
              "}",
            ],
            type: "text/javascript",
          },
        },
      ];
      item.request.body = {
        mode: "raw",
        raw: JSON.stringify({ email: "admin@tallero.test", password: "AdminTallero123!" }, null, 2),
      };
    }

    foldersMap.get(tagName).push(item);
  }

  const postmanItems = [];
  for (const [folderName, items] of foldersMap.entries()) {
    postmanItems.push({
      name: folderName,
      item: items,
    });
  }

  const postmanCollection = {
    info: {
      name: "Tallero Auto API Collection",
      _postman_id: "tallero-auto-api-v1",
      description: "Koleksi 106 endpoint resmi Tallero Auto API dengan auto-token JWT injection",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: {
      type: "bearer",
      bearer: [
        {
          key: "token",
          value: "{{accessToken}}",
          type: "string",
        },
      ],
    },
    item: postmanItems,
  };

  const postmanPath = path.join(docsDir, "tallero-auto.postman_collection.json");
  fs.writeFileSync(postmanPath, JSON.stringify(postmanCollection, null, 2), "utf8");
  console.log(`✅ Postman Collection (106 endpoints) berhasil diekspor ke: ${postmanPath}`);

  // 3. Postman Environment
  const postmanEnvironment = {
    id: "tallero-auto-env-local",
    name: "Tallero Auto Local",
    values: [
      {
        key: "baseUrl",
        value: "http://localhost:5000/api/v1",
        type: "default",
        enabled: true,
      },
      {
        key: "accessToken",
        value: "",
        type: "secret",
        enabled: true,
      },
    ],
    _postman_variable_scope: "environment",
  };

  const envPath = path.join(docsDir, "tallero-auto.postman_environment.json");
  fs.writeFileSync(envPath, JSON.stringify(postmanEnvironment, null, 2), "utf8");
  console.log(`✅ Postman Environment berhasil diekspor ke: ${envPath}`);
};

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  exportFiles();
}

export default {
  generateOpenApiSpec,
  exportFiles,
  ALL_ENDPOINTS,
};
