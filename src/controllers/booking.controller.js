const prisma = require("../config/prisma.config");
const resend = require("../config/resend.config");
const AppError = require("../utils/appError.util");

const generateBookingCode = () => {
  const timestamp = Date.now().toString();
  const random3 = Math.floor(100 + Math.random() * 900).toString();
  return `TLLR-${timestamp}-${random3}`;
};

const createBooking = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { outletId, vehicleId, serviceId, bookingDate, customerNotes } = req.body;

    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, userId } });
    if (!vehicle) return next(new AppError("Vehicle not found or not owned by user.", 400));

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return next(new AppError("Service not found.", 400));

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) return next(new AppError("Outlet not found.", 400));

    const bookingCode = generateBookingCode();
    
    const booking = await prisma.booking.create({
      data: {
        bookingCode,
        userId,
        outletId,
        vehicleId,
        serviceId,
        bookingDate: new Date(bookingDate),
        status: "PENDING",
        customerNotes: customerNotes || null,
        totalPrice: service.price,
      },
      include: { service: true, vehicle: true }
    });

    // Create initial log
    await prisma.bookingLog.create({
      data: {
        bookingId: booking.id,
        actorId: userId,
        status: "PENDING",
        notes: "Booking created by customer",
      }
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("new_booking_created", {
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          customerName: req.user.name,
          service: booking.service.name,
        });
      }
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    res.status(201).json({ status: "success", data: { booking } });
  } catch (error) {
    next(error);
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const bookings = await prisma.booking.findMany({
      where: { userId },
      include: { outlet: true, vehicle: true, service: true, photos: true, review: true },
      orderBy: { bookingDate: "desc" },
    });
    res.status(200).json({ status: "success", data: { bookings } });
  } catch (error) {
    next(error);
  }
};

const getBookingById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        mechanic: { select: { name: true } },
        outlet: true,
        vehicle: true,
        service: true,
        photos: true,
        review: true,
        statusLogs: {
          include: { actor: { select: { name: true, role: true } } },
          orderBy: { createdAt: "desc" },
        }
      },
    });

    if (!booking) return next(new AppError("Booking not found.", 404));

    res.status(200).json({ status: "success", data: { booking } });
  } catch (error) {
    next(error);
  }
};

const getAllBookings = async (req, res, next) => {
  try {
    const { status, outletId, search } = req.query;
    const whereClause = {};

    if (status) whereClause.status = status;
    if (outletId) whereClause.outletId = parseInt(outletId, 10);
    if (search) {
      whereClause.OR = [
        { bookingCode: { contains: search, mode: "insensitive" } },
        { user: { name: { contains: search, mode: "insensitive" } } },
        { vehicle: { licensePlate: { contains: search, mode: "insensitive" } } },
      ];
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, email: true } },
        outlet: true,
        vehicle: true,
        service: true,
      },
      orderBy: { bookingDate: "desc" },
    });

    res.status(200).json({ status: "success", data: { bookings } });
  } catch (error) {
    next(error);
  }
};

const checkInByQr = async (req, res, next) => {
  try {
    const { bookingCode } = req.body;

    const existingBooking = await prisma.booking.findUnique({ where: { bookingCode } });
    if (!existingBooking) return next(new AppError("Booking not found.", 404));

    const updatedBooking = await prisma.booking.update({
      where: { bookingCode },
      data: { status: "CHECKED_IN" },
    });

    await prisma.bookingLog.create({
      data: {
        bookingId: updatedBooking.id,
        actorId: req.user.id, // The admin scanning it
        status: "CHECKED_IN",
        notes: "Vehicle checked in via QR",
      }
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("booking_status_updated", {
          bookingId: updatedBooking.id,
          bookingCode: updatedBooking.bookingCode,
          status: updatedBooking.status,
        });
      }
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    res.status(200).json({ status: "success", data: { booking: updatedBooking } });
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, adminNotes } = req.body;

    const existingBooking = await prisma.booking.findUnique({
      where: { id },
      include: { user: true, vehicle: true },
    });

    if (!existingBooking) return next(new AppError("Booking not found.", 404));

    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: {
        status,
        adminNotes: adminNotes !== undefined ? adminNotes : existingBooking.adminNotes,
      },
      include: { user: true, vehicle: true },
    });

    await prisma.bookingLog.create({
      data: {
        bookingId: updatedBooking.id,
        actorId: req.user.id,
        status: updatedBooking.status,
        notes: adminNotes || `Status updated to ${status}`,
      }
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("booking_status_updated", {
          bookingId: updatedBooking.id,
          bookingCode: updatedBooking.bookingCode,
          status: updatedBooking.status,
        });
      }
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    if (status === "READY_FOR_PICKUP") {
      try {
        await resend.emails.send({
          from: "Tallero <noreply@resend.dev>",
          to: updatedBooking.user.email,
          subject: "Your Vehicle is Ready for Pickup!",
          html: `<p>Hi ${updatedBooking.user.name},</p>
                 <p>Your vehicle <strong>${updatedBooking.vehicle.brand} ${updatedBooking.vehicle.model} (${updatedBooking.vehicle.licensePlate})</strong> is ready for pickup.</p>`,
        });
      } catch (err) {
        console.error("Resend email failed:", err.message);
      }
    }

    res.status(200).json({ status: "success", data: { booking: updatedBooking } });
  } catch (error) {
    next(error);
  }
};

const completePayment = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { paymentMethod, serviceFee, additionalFee, totalPrice } = req.body;

    const existingBooking = await prisma.booking.findUnique({ where: { id } });
    if (!existingBooking) return next(new AppError("Booking not found.", 404));

    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: {
        status: "COMPLETED",
        paymentStatus: "PAID",
        paymentMethod,
        serviceFee: serviceFee || 0,
        additionalFee: additionalFee || 0,
        totalPrice,
        paidAt: new Date(),
      },
    });

    await prisma.bookingLog.create({
      data: {
        bookingId: updatedBooking.id,
        actorId: req.user.id,
        status: "COMPLETED",
        notes: `Payment completed via ${paymentMethod}`,
      }
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("booking_status_updated", {
          bookingId: updatedBooking.id,
          bookingCode: updatedBooking.bookingCode,
          status: updatedBooking.status,
        });
      }
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    res.status(200).json({ status: "success", data: { booking: updatedBooking } });
  } catch (error) {
    next(error);
  }
};

const uploadPhoto = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { type, caption } = req.body; // Multer saves file path to req.file
    
    if (!req.file) {
      return next(new AppError("No image file provided.", 400));
    }

    const photoPath = `/uploads/${req.file.filename}`;

    const existingBooking = await prisma.booking.findUnique({ where: { id } });
    if (!existingBooking) return next(new AppError("Booking not found.", 404));

    const photo = await prisma.bookingPhoto.create({
      data: {
        bookingId: id,
        photoPath,
        type,
        caption: caption || null,
      },
    });

    await prisma.bookingLog.create({
      data: {
        bookingId: id,
        actorId: req.user.id,
        status: existingBooking.status,
        notes: `Uploaded ${type} photo`,
      }
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("booking_photo_uploaded", {
          bookingId: id,
          photoId: photo.id,
          type,
        });
      }
    } catch (err) {
      console.error("Socket emit failed:", err.message);
    }

    res.status(201).json({ status: "success", data: { photo } });
  } catch (error) {
    next(error);
  }
};

const getBookingHistoryLogs = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    const logs = await prisma.bookingLog.findMany({
      where: { bookingId: id },
      include: {
        actor: { select: { name: true, role: true } }
      },
      orderBy: { createdAt: "asc" },
    });

    res.status(200).json({ status: "success", data: { logs } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getBookingById,
  getAllBookings,
  checkInByQr,
  updateStatus,
  completePayment,
  uploadPhoto,
  getBookingHistoryLogs,
};
