const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(new AppError("You are not logged in! Please log in to get access.", 401));
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "rahasia_tallero_123");

    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!currentUser) {
      return next(new AppError("The user belonging to this token does no longer exist.", 401));
    }

    if (!currentUser.isActive) {
      return next(new AppError("This account has been deactivated.", 403));
    }

    req.user = currentUser;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return next(new AppError("Invalid token. Please log in again.", 401));
    }
    if (error.name === "TokenExpiredError") {
      return next(new AppError("Your token has expired! Please log in again.", 401));
    }
    next(error);
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError("You do not have permission to perform this action", 403));
    }
    next();
  };
};

module.exports = {
  verifyToken,
  authorizeRoles,
};
