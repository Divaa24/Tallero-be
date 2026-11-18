import { withDeleted } from "../../src/config/prisma.js";

/**
 * Membersihkan seluruh tabel transaksi dan master data pada test database secara tuntas
 * Mengikuti urutan foreign key dependency agar tidak melanggar referential integrity.
 */
export const resetTestDb = async () => {
  await withDeleted.auditLog.deleteMany({});
  await withDeleted.payment.deleteMany({});
  await withDeleted.review.deleteMany({});
  await withDeleted.notification.deleteMany({});
  await withDeleted.deviceToken.deleteMany({});
  await withDeleted.bookingPhoto.deleteMany({});
  await withDeleted.bookingItem.deleteMany({});
  await withDeleted.bookingLog.deleteMany({});
  await withDeleted.serviceReminder.deleteMany({});
  await withDeleted.booking.deleteMany({});
  await withDeleted.vehicle.deleteMany({});
  await withDeleted.service.deleteMany({});
  await withDeleted.category.deleteMany({});
  await withDeleted.sparepart.deleteMany({});
  await withDeleted.outletClosure.deleteMany({});
  await withDeleted.refreshToken.deleteMany({});
  await withDeleted.passwordResetToken.deleteMany({});
  await withDeleted.registrationOtp.deleteMany({});
  await withDeleted.user.deleteMany({});
  await withDeleted.outlet.deleteMany({});
};

export default { resetTestDb };
