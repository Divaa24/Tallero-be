import RULES from "../config/rules.js";
import {
  BadRequestError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors.js";

/**
 * Peta transisi deklaratif status booking sesuai state machine AGENTS.md §8
 */
export const LEGAL_TRANSITIONS = Object.freeze({
  PENDING: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_APPROVAL", "READY_FOR_PICKUP", "CANCELLED"],
  WAITING_APPROVAL: ["IN_PROGRESS", "CANCELLED"],
  READY_FOR_PICKUP: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
});

/**
 * Memeriksa apakah transisi dari fromStatus ke toStatus secara deklaratif legal
 */
export const isTransitionAllowed = (fromStatus, toStatus) => {
  const allowed = LEGAL_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
};

/**
 * Satu pintu perubahan status booking (AGENTS.md §8).
 * Menjalankan validasi akses, cek transisi legal, cek guard spesifik status,
 * penyesuaian efek samping (stok/foto/tagihan/antrian), update bersyarat anti-race,
 * pencatatan BookingLog, dan menghasilkan event realtime pasca-commit.
 *
 * @param {object} tx - Prisma transaction client
 * @param {number} bookingId - ID booking
 * @param {string} toStatus - Status target BookingStatus
 * @param {object} actor - Pengguna yang melakukan aksi ({ id, role, outletId? })
 * @param {object} [opts={}] - Opsi transisi (reason, note, now, queueDate, queueNumber, isLate, mechanicId, etc.)
 */
export const transition = async (tx, bookingId, toStatus, actor, opts = {}) => {
  const now = opts.now instanceof Date ? opts.now : new Date();

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      code: true,
      customerId: true,
      outletId: true,
      mechanicId: true,
      status: true,
      scheduledAt: true,
      slotEndAt: true,
      total: true,
      paymentStatus: true,
      vehicleId: true,
      invoiceNumber: true,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  // Cek apakah transisi terdaftar dalam peta deklaratif
  if (!isTransitionAllowed(booking.status, toStatus)) {
    throw new ConflictError(
      `Perubahan status booking dari ${booking.status} ke ${toStatus} tidak diizinkan`,
      "INVALID_TRANSITION"
    );
  }

  const updateData = { status: toStatus };
  let logNote = opts.note || `Status booking diubah menjadi ${toStatus}`;

  // ============================================================================
  // GUARDS DAN EFEK SAMPING SPESIFIK TRANSISI
  // ============================================================================

  // 1. PENDING -> CHECKED_IN
  if (toStatus === "CHECKED_IN") {
    if (actor.role === "MECHANIC" && actor.outletId !== booking.outletId) {
      throw new ForbiddenError(
        "Mekanik hanya dapat memproses check-in untuk outlet tempatnya bertugas",
        "FORBIDDEN_OUTLET"
      );
    }
    if (actor.role !== "ADMIN" && actor.role !== "MECHANIC") {
      throw new ForbiddenError(
        "Hanya staf bengkel atau admin yang dapat memproses check-in",
        "FORBIDDEN"
      );
    }

    if (!opts.queueDate || !opts.queueNumber) {
      throw new BadRequestError(
        "Nomor dan tanggal antrian wajib disertakan saat check-in",
        "QUEUE_INFO_REQUIRED"
      );
    }

    updateData.queueDate = opts.queueDate;
    updateData.queueNumber = opts.queueNumber;
    updateData.checkedInAt = now;
    updateData.isLate = opts.isLate ?? now.getTime() > booking.scheduledAt.getTime();
    if (opts.odometerKm !== undefined && opts.odometerKm !== null) {
      updateData.odometerKm = opts.odometerKm;
    }
    logNote = opts.note || `Pelanggan check-in. Nomor antrian: ${opts.queueNumber}`;
  }

  // 2. PENDING -> NO_SHOW
  else if (toStatus === "NO_SHOW") {
    if (actor.role !== "SYSTEM" && actor.role !== "ADMIN") {
      throw new ForbiddenError(
        "Hanya sistem otomatis atau admin yang dapat menandai booking sebagai NO_SHOW",
        "FORBIDDEN"
      );
    }

    const graceMs = RULES.NO_SHOW_GRACE_MINUTES * 60 * 1000;
    if (now.getTime() <= booking.slotEndAt.getTime() + graceMs) {
      throw new BusinessRuleError(
        `Booking belum melewati batas toleransi keterlambatan (${RULES.NO_SHOW_GRACE_MINUTES} menit setelah slot selesai)`,
        "NO_SHOW_GRACE_PERIOD_ACTIVE"
      );
    }

    logNote = opts.note || "Booking ditandai NO_SHOW otomatis oleh sistem";
  }

  // 3. CHECKED_IN -> IN_PROGRESS
  else if (booking.status === "CHECKED_IN" && toStatus === "IN_PROGRESS") {
    if (actor.role !== "ADMIN" && actor.role !== "MECHANIC") {
      throw new ForbiddenError(
        "Hanya staf bengkel atau admin yang dapat memulai pengerjaan booking",
        "FORBIDDEN"
      );
    }

    const assignedMechanicId = opts.mechanicId || booking.mechanicId || actor.id;
    if (!assignedMechanicId) {
      throw new BadRequestError(
        "Mekanik wajib ditentukan sebelum pengerjaan dimulai",
        "MECHANIC_REQUIRED"
      );
    }

    updateData.mechanicId = assignedMechanicId;
    updateData.startedAt = now;
    logNote = opts.note || `Pengerjaan servis dimulai oleh mekanik ID ${assignedMechanicId}`;
  }

  // 4. IN_PROGRESS -> WAITING_APPROVAL
  else if (booking.status === "IN_PROGRESS" && toStatus === "WAITING_APPROVAL") {
    if (actor.role === "MECHANIC" && actor.id !== booking.mechanicId) {
      throw new ForbiddenError(
        "Hanya mekanik penangan atau admin yang dapat meminta persetujuan pelanggan",
        "FORBIDDEN"
      );
    }

    const pendingCount = await tx.bookingItem.count({
      where: {
        bookingId,
        approvalStatus: "PENDING_APPROVAL",
      },
    });

    if (pendingCount === 0) {
      throw new BusinessRuleError(
        "Tidak ada item tambahan yang membutuhkan persetujuan pelanggan",
        "NO_PENDING_APPROVAL_ITEMS"
      );
    }

    logNote = opts.note || "Menunggu persetujuan pelanggan untuk item tambahan";
  }

  // 5. WAITING_APPROVAL -> IN_PROGRESS
  else if (booking.status === "WAITING_APPROVAL" && toStatus === "IN_PROGRESS") {
    const pendingCount = await tx.bookingItem.count({
      where: {
        bookingId,
        approvalStatus: "PENDING_APPROVAL",
      },
    });

    if (pendingCount > 0) {
      throw new ConflictError(
        "Masih terdapat item tambahan yang belum diputuskan oleh pelanggan",
        "PENDING_ITEMS_EXIST"
      );
    }

    // Potong stok suku cadang yang baru saja disetujui
    const approvedSpareparts = await tx.bookingItem.findMany({
      where: {
        bookingId,
        type: "SPAREPART",
        approvalStatus: "APPROVED",
        stockDeducted: false,
      },
    });

    for (const item of approvedSpareparts) {
      if (!item.sparepartId) continue;
      const deduction = await tx.sparepart.updateMany({
        where: {
          id: item.sparepartId,
          stock: { gte: item.quantity },
        },
        data: {
          stock: { decrement: item.quantity },
        },
      });

      if (deduction.count !== 1) {
        throw new ConflictError(
          `Stok sparepart "${item.nameSnapshot}" tidak mencukupi untuk item yang disetujui`,
          "STOCK_INSUFFICIENT"
        );
      }

      await tx.bookingItem.update({
        where: { id: item.id },
        data: { stockDeducted: true },
      });
    }

    logNote = opts.note || "Semua item tambahan telah diputuskan, servis dilanjutkan";
  }

  // 6. IN_PROGRESS -> READY_FOR_PICKUP
  else if (booking.status === "IN_PROGRESS" && toStatus === "READY_FOR_PICKUP") {
    if (actor.role === "MECHANIC" && actor.id !== booking.mechanicId) {
      throw new ForbiddenError(
        "Hanya mekanik penangan atau admin yang dapat menandai kendaraan siap diambil",
        "FORBIDDEN"
      );
    }

    const pendingItemsCount = await tx.bookingItem.count({
      where: {
        bookingId,
        approvalStatus: "PENDING_APPROVAL",
      },
    });

    if (pendingItemsCount > 0) {
      throw new ConflictError(
        "Masih terdapat item tambahan yang menunggu persetujuan",
        "PENDING_ITEMS_EXIST"
      );
    }

    // Guard foto inspeksi: minimal 1 BEFORE dan 1 AFTER
    const beforePhotoCount = await tx.bookingPhoto.count({
      where: { bookingId, type: "BEFORE", deletedAt: null },
    });
    const afterPhotoCount = await tx.bookingPhoto.count({
      where: { bookingId, type: "AFTER", deletedAt: null },
    });

    if (beforePhotoCount === 0 || afterPhotoCount === 0) {
      throw new BusinessRuleError(
        "Pengerjaan wajib memiliki minimal 1 foto BEFORE dan 1 foto AFTER sebelum siap diambil",
        "PHOTOS_INCOMPLETE"
      );
    }

    // Hitung ulang total resmi hanya dari item APPROVED
    const approvedItems = await tx.bookingItem.findMany({
      where: { bookingId, approvalStatus: "APPROVED" },
      select: { subtotal: true },
    });
    const recalculatedTotal = approvedItems.reduce((sum, item) => sum + item.subtotal, 0);

    updateData.total = recalculatedTotal;
    updateData.readyAt = now;
    logNote = opts.note || "Servis selesai, kendaraan siap diambil oleh pelanggan";
  }

  // 7. READY_FOR_PICKUP -> COMPLETED
  else if (booking.status === "READY_FOR_PICKUP" && toStatus === "COMPLETED") {
    if (actor.role !== "ADMIN") {
      throw new ForbiddenError(
        "Hanya admin/kasir yang berhak menyelesaikan transaksi booking",
        "FORBIDDEN"
      );
    }

    if (booking.paymentStatus !== "PAID") {
      throw new ConflictError(
        "Pembayaran booking belum lunas (UNPAID). Transaksi belum dapat diselesaikan.",
        "BOOKING_NOT_PAID"
      );
    }

    updateData.completedAt = now;
    if (!booking.invoiceNumber) {
      updateData.invoiceNumber = opts.invoiceNumber || `INV-${booking.code.replace(/^TLR-/, "")}`;
    }
    logNote = opts.note || "Transaksi lunas dan kendaraan diserahkan ke pelanggan";
  }

  // 8. TRANSISI KE CANCELLED (Dari PENDING, CHECKED_IN, IN_PROGRESS, WAITING_APPROVAL)
  else if (toStatus === "CANCELLED") {
    if (booking.status === "PENDING") {
      if (actor.role === "CUSTOMER") {
        if (booking.customerId !== actor.id) {
          throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
        }

        const cutoffMs = RULES.CANCEL_CUTOFF_MINUTES * 60 * 1000;
        const scheduledTime = booking.scheduledAt.getTime();
        if (now.getTime() > scheduledTime - cutoffMs) {
          throw new BusinessRuleError(
            `Pembatalan oleh pelanggan hanya dapat dilakukan paling lambat ${RULES.CANCEL_CUTOFF_MINUTES} menit sebelum waktu jadwal`,
            "CANCEL_CUTOFF_EXCEEDED"
          );
        }

        const reason = opts.reason?.trim() || "Dibatalkan oleh pelanggan";
        updateData.cancelledAt = now;
        updateData.cancelledById = actor.id;
        updateData.cancelReason = reason;
        logNote = `Dibatalkan oleh pelanggan: ${reason}`;
      } else if (actor.role === "ADMIN") {
        const reason = opts.reason?.trim();
        if (!reason || reason.length < 3) {
          throw new BadRequestError(
            "Alasan pembatalan oleh admin wajib diisi minimal 3 karakter",
            "CANCEL_REASON_REQUIRED"
          );
        }

        updateData.cancelledAt = now;
        updateData.cancelledById = actor.id;
        updateData.cancelReason = reason;
        logNote = `Dibatalkan oleh admin: ${reason}`;
      } else {
        throw new ForbiddenError(
          "Mekanik tidak memiliki wewenang untuk membatalkan booking",
          "FORBIDDEN"
        );
      }
    } else {
      // Pembatalan saat CHECKED_IN, IN_PROGRESS, atau WAITING_APPROVAL
      if (actor.role !== "ADMIN") {
        throw new ForbiddenError(
          "Hanya admin yang dapat membatalkan booking setelah pelanggan check-in",
          "FORBIDDEN"
        );
      }

      const reason = opts.reason?.trim();
      if (!reason || reason.length < 3) {
        throw new BadRequestError(
          "Alasan pembatalan oleh admin wajib diisi minimal 3 karakter",
          "CANCEL_REASON_REQUIRED"
        );
      }

      updateData.cancelledAt = now;
      updateData.cancelledById = actor.id;
      updateData.cancelReason = reason;
      logNote = `Dibatalkan oleh admin (${booking.status}): ${reason}`;

      // Kembalikan stok sparepart yang telah dipotong sebelumnya
      const itemsToRefundStock = await tx.bookingItem.findMany({
        where: {
          bookingId,
          type: "SPAREPART",
          stockDeducted: true,
        },
      });

      for (const item of itemsToRefundStock) {
        if (!item.sparepartId) continue;
        await tx.sparepart.update({
          where: { id: item.sparepartId },
          data: {
            stock: { increment: item.quantity },
          },
        });
        await tx.bookingItem.update({
          where: { id: item.id },
          data: { stockDeducted: false },
        });
      }
    }
  }

  // Eksekusi update bersyarat untuk mencegah race condition konkuren
  const claimed = await tx.booking.updateMany({
    where: {
      id: bookingId,
      status: booking.status,
    },
    data: updateData,
  });

  if (claimed.count !== 1) {
    throw new ConflictError(
      "Status booking telah berubah oleh proses lain. Silakan muat ulang data.",
      "CONCURRENT_STATUS_CHANGE"
    );
  }

  // Catat riwayat perubahan ke tabel booking_logs
  await tx.bookingLog.create({
    data: {
      bookingId,
      actorId: actor.id ?? null,
      actorRole: actor.role ?? "SYSTEM",
      fromStatus: booking.status,
      toStatus,
      note: logNote,
      createdAt: now,
    },
  });

  const updatedBooking = { ...booking, ...updateData };

  const events = [
    {
      event: "booking:status_changed",
      payload: {
        bookingId,
        code: booking.code,
        fromStatus: booking.status,
        toStatus,
        outletId: booking.outletId,
        customerId: booking.customerId,
        updatedAt: now.toISOString(),
      },
      rooms: [`user:${booking.customerId}`, `outlet:${booking.outletId}:staff`, "admin"],
    },
  ];

  return {
    booking: updatedBooking,
    events,
  };
};

export default {
  LEGAL_TRANSITIONS,
  isTransitionAllowed,
  transition,
};
