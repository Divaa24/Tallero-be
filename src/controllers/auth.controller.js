const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");
const { generateToken } = require("../utils/jwt.util");
const { generateOtp, sendAuthEmail } = require("../utils/auth.util");

const register = async (req, res, next) => {
  try {
    const { name, email, password, phone, address } = req.body;

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      if (user.isVerified) {
        return next(new AppError("Email already registered and verified.", 400));
      }
      // User exists but unverified, update OTP
      const otpCode = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const hashedPassword = await bcrypt.hash(password, 10);

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name,
          password: hashedPassword,
          phone,
          address: address || null,
          otpCode,
          otpExpiresAt,
        },
      });
    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(password, 10);
      const otpCode = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      user = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          phone,
          address: address || null,
          role: "CUSTOMER",
          isVerified: false,
          otpCode,
          otpExpiresAt,
        },
      });
    }

    await sendAuthEmail({
      email: user.email,
      name: user.name,
      otpCode: user.otpCode,
      type: "REGISTER",
    });

    res.status(201).json({
      status: "success",
      data: {
        message: "Registration successful. Please check your email for the OTP.",
        userId: user.id,
      },
    });
  } catch (error) {
    next(error);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { email, otpCode } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return next(new AppError("User not found.", 404));
    }

    if (user.isVerified) {
      return next(new AppError("Account is already verified.", 400));
    }

    if (user.otpCode !== otpCode) {
      return next(new AppError("Invalid OTP code.", 400));
    }

    if (new Date() > new Date(user.otpExpiresAt)) {
      return next(new AppError("OTP has expired.", 400));
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    const token = generateToken({ id: updatedUser.id, role: updatedUser.role });

    res.status(200).json({
      status: "success",
      data: { 
        message: "Account verified successfully.",
        token,
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
        }
      },
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return next(new AppError("Invalid credentials.", 401));
    }

    if (!user.isVerified) {
      return next(new AppError("Account is not verified. Please verify your OTP.", 403));
    }

    if (!user.isActive) {
      return next(new AppError("Account has been deactivated. Contact support.", 403));
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return next(new AppError("Invalid credentials.", 401));
    }

    const token = generateToken({ id: user.id, role: user.role });

    res.status(200).json({
      status: "success",
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Return success anyway for security reasons to prevent email enumeration
      return res.status(200).json({
        status: "success",
        data: { message: "If that email is in our database, we will send a password reset OTP." },
      });
    }

    const otpCode = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode,
        otpExpiresAt,
      },
    });

    await sendAuthEmail({
      email: user.email,
      name: user.name,
      otpCode,
      type: "FORGOT_PASSWORD",
    });

    res.status(200).json({
      status: "success",
      data: { message: "If that email is in our database, we will send a password reset OTP." },
    });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { email, otpCode, newPassword } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return next(new AppError("User not found.", 404));
    }

    if (user.otpCode !== otpCode) {
      return next(new AppError("Invalid OTP code.", 400));
    }

    if (new Date() > new Date(user.otpExpiresAt)) {
      return next(new AppError("OTP has expired.", 400));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    res.status(200).json({
      status: "success",
      data: { message: "Password reset successfully. You can now login." },
    });
  } catch (error) {
    next(error);
  }
};

const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        avatar: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      return next(new AppError("User not found.", 404));
    }

    res.status(200).json({
      status: "success",
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  verifyOtp,
  login,
  forgotPassword,
  resetPassword,
  getProfile,
};
