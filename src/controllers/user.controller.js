const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");

const getAllUsers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { search, role } = req.query;

    const whereClause = {};

    if (role) {
      whereClause.role = role;
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        users,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        vehicles: true,
        bookings: {
          include: {
            service: true,
            vehicle: true,
            outlet: true,
          },
          orderBy: { bookingDate: "desc" },
        },
      },
    });

    if (!user) {
      return next(new AppError("User not found.", 404));
    }

    // Exclude sensitive fields
    const { password, otpCode, otpExpiresAt, ...safeUser } = user;

    res.status(200).json({
      status: "success",
      data: { user: safeUser },
    });
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    const { name, email, password, phone, address, role, isActive } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return next(new AppError("Email already exists.", 400));
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone,
        address,
        role: role || "CUSTOMER",
        isActive: isActive !== undefined ? isActive : true,
        isVerified: true, // Auto-verify admin created users
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      status: "success",
      data: { user: newUser },
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, email, phone, address, role, isActive } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return next(new AppError("User not found.", 404));
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        name: name !== undefined ? name : existingUser.name,
        email: email !== undefined ? email : existingUser.email,
        phone: phone !== undefined ? phone : existingUser.phone,
        address: address !== undefined ? address : existingUser.address,
        role: role !== undefined ? role : existingUser.role,
        isActive: isActive !== undefined ? isActive : existingUser.isActive,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
      },
    });

    res.status(200).json({
      status: "success",
      data: { user: updatedUser },
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return next(new AppError("User not found.", 404));
    }

    await prisma.user.delete({ where: { id } });

    res.status(200).json({
      status: "success",
      data: { message: "User deleted successfully." },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};
