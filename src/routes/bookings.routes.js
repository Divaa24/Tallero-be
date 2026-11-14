import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import { uploadSingleImage } from "../middlewares/upload.js";
import {
  addBookingItemSchema,
  assignMechanicSchema,
  bookingApprovalSchema,
  bookingIdParamSchema,
  bookingInspectionSchema,
  bookingPhotoUploadSchema,
  cancelBookingSchema,
  checkInBookingSchema,
  createBookingSchema,
  deleteBookingItemSchema,
  deleteBookingPhotoSchema,
  listBookingsSchema,
  startBookingSchema,
} from "../validations/bookings.validation.js";
import * as bookingsController from "../controllers/bookings.controller.js";
import paymentsController from "../controllers/payments.controller.js";
import reviewsController from "../controllers/reviews.controller.js";
import { createTipSchema, completeBookingSchema } from "../validations/payments.validation.js";
import { createReviewSchema } from "../validations/reviews.validation.js";

const bookingsRouter = Router();

// Seluruh endpoint booking memerlukan pengguna yang terautentikasi
bookingsRouter.use(authenticate);

// 1. Check-in booking via QR payload (Staf: MECHANIC atau ADMIN)
// Ditempatkan sebelum /:id agar tidak tertimpa route dinamis
bookingsRouter.post(
  "/check-in",
  authorize("MECHANIC", "ADMIN"),
  validate(checkInBookingSchema),
  bookingsController.checkInBooking
);

// 2. Buat booking baru (hanya CUSTOMER pemilik kendaraan)
bookingsRouter.post(
  "/",
  authorize("CUSTOMER"),
  validate(createBookingSchema),
  bookingsController.createBooking
);

// 3. Daftar booking (di-scope per role: Customer / Mekanik / Admin)
bookingsRouter.get(
  "/",
  authorize("CUSTOMER", "MECHANIC", "ADMIN"),
  validate(listBookingsSchema),
  bookingsController.listBookings
);

// 4. Detail booking (di-scope per role, IDOR -> 404)
bookingsRouter.get(
  "/:id",
  authorize("CUSTOMER", "MECHANIC", "ADMIN"),
  validate(bookingIdParamSchema),
  bookingsController.getBooking
);

// 5. Riwayat audit log status booking
bookingsRouter.get(
  "/:id/logs",
  authorize("CUSTOMER", "MECHANIC", "ADMIN"),
  validate(bookingIdParamSchema),
  bookingsController.getBookingLogs
);

// 6. Payload QR code untuk check-in (Customer pemilik booking)
bookingsRouter.get(
  "/:id/qr",
  authorize("CUSTOMER"),
  validate(bookingIdParamSchema),
  bookingsController.getBookingQr
);

// 7. Cek posisi antrian booking (Customer pemilik)
bookingsRouter.get(
  "/:id/queue-position",
  authorize("CUSTOMER"),
  validate(bookingIdParamSchema),
  bookingsController.getQueuePosition
);

// 8. Batalkan booking (Customer pemilik dengan aturan cutoff, atau Admin dengan alasan wajib)
bookingsRouter.post(
  "/:id/cancel",
  authorize("CUSTOMER", "ADMIN"),
  validate(cancelBookingSchema),
  bookingsController.cancelBooking
);

// 9. Tugaskan mekanik ke booking (Hanya ADMIN)
bookingsRouter.post(
  "/:id/assign",
  authorize("ADMIN"),
  validate(assignMechanicSchema),
  bookingsController.assignMechanic
);

// 10. Mulai pengerjaan servis (MECHANIC atau ADMIN)
bookingsRouter.post(
  "/:id/start",
  authorize("MECHANIC", "ADMIN"),
  validate(startBookingSchema),
  bookingsController.startBooking
);

// 11. Pengajuan item tambahan oleh mekanik penangan / admin
bookingsRouter.post(
  "/:id/items",
  authorize("MECHANIC", "ADMIN"),
  validate(addBookingItemSchema),
  bookingsController.addBookingItem
);

// 12. Hapus/tarik item tambahan berstatus PENDING_APPROVAL oleh mekanik penangan / admin
bookingsRouter.delete(
  "/:id/items/:itemId",
  authorize("MECHANIC", "ADMIN"),
  validate(deleteBookingItemSchema),
  bookingsController.deleteBookingItem
);

// 13. Keputusan persetujuan batch atas item tambahan (Customer pemilik atau Admin atas nama customer)
bookingsRouter.post(
  "/:id/approvals",
  authorize("CUSTOMER", "ADMIN"),
  validate(bookingApprovalSchema),
  bookingsController.decideBookingApprovals
);

// 14. Unggah foto inspeksi BEFORE / AFTER (Mekanik penangan atau Admin)
bookingsRouter.post(
  "/:id/photos",
  authorize("MECHANIC", "ADMIN"),
  uploadSingleImage,
  validate(bookingPhotoUploadSchema),
  bookingsController.uploadBookingPhoto
);

// 15. Daftar foto inspeksi booking (Customer pemilik / Staf)
bookingsRouter.get(
  "/:id/photos",
  authorize("CUSTOMER", "MECHANIC", "ADMIN"),
  validate(bookingIdParamSchema),
  bookingsController.listBookingPhotos
);

// 16. Hapus foto inspeksi (Uploader atau Admin)
bookingsRouter.delete(
  "/:id/photos/:photoId",
  authorize("MECHANIC", "ADMIN"),
  validate(deleteBookingPhotoSchema),
  bookingsController.deleteBookingPhoto
);

// 17. Perbarui odometer dan catatan inspeksi staf (Mekanik penangan atau Admin)
bookingsRouter.patch(
  "/:id/inspection",
  authorize("MECHANIC", "ADMIN"),
  validate(bookingInspectionSchema),
  bookingsController.updateInspection
);

// 18. Tandai pengerjaan selesai dan kendaraan siap diambil (READY_FOR_PICKUP)
bookingsRouter.post(
  "/:id/ready",
  authorize("MECHANIC", "ADMIN"),
  validate(bookingIdParamSchema),
  bookingsController.markBookingReady
);

// 19. Buat sesi pembayaran Midtrans Snap untuk pelunasan invoice (Customer pemilik / Admin)
bookingsRouter.post(
  "/:id/payments/midtrans",
  authorize("CUSTOMER", "ADMIN"),
  validate(bookingIdParamSchema),
  paymentsController.createMidtransPayment
);

// 20. Pembayaran tunai kasir (Admin)
bookingsRouter.post(
  "/:id/payments/cash",
  authorize("ADMIN"),
  validate(bookingIdParamSchema),
  paymentsController.payCash
);

// 21. Beri tip sukarela untuk mekanik penangan (Customer)
bookingsRouter.post(
  "/:id/tips",
  authorize("CUSTOMER"),
  validate(bookingIdParamSchema),
  validate(createTipSchema),
  paymentsController.createTip
);

// 22. Riwayat transaksi pembayaran pada booking (Customer pemilik / Admin)
bookingsRouter.get(
  "/:id/payments",
  authorize("CUSTOMER", "ADMIN"),
  validate(bookingIdParamSchema),
  paymentsController.listPayments
);

// 23. Unduh faktur resmi pembayaran dalam format PDF (Customer pemilik / Admin, hanya bila PAID)
bookingsRouter.get(
  "/:id/invoice.pdf",
  authorize("CUSTOMER", "ADMIN"),
  validate(bookingIdParamSchema),
  paymentsController.downloadInvoicePdf
);

// 24. Selesaikan transaksi booking setelah lunas (Admin)
bookingsRouter.post(
  "/:id/complete",
  authorize("ADMIN"),
  validate(bookingIdParamSchema),
  validate(completeBookingSchema),
  bookingsController.completeBooking
);

// 25. Berikan ulasan dan rating pada booking yang telah selesai (Customer pemilik)
bookingsRouter.post(
  "/:id/review",
  authorize("CUSTOMER"),
  validate(bookingIdParamSchema),
  validate(createReviewSchema),
  reviewsController.createBookingReview
);

export default bookingsRouter;
