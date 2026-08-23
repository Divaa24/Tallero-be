const AppError = require("../utils/appError.util");

const errorMiddleware = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  
  if (process.env.NODE_ENV !== "test") {
    console.error(err);
  }

  // Prisma unique constraint error
  if (err.code === "P2002") {
    const target = err.meta?.target ? err.meta.target.join(", ") : "field";
    error = new AppError(`Constraint violation: ${target} already exists.`, 400);
  }
  
  // Prisma record not found
  if (err.code === "P2025") {
    error = new AppError("Record not found.", 404);
  }

  // Handle generic AppError
  if (error instanceof AppError || err instanceof AppError) {
    return res.status(error.statusCode || err.statusCode).json({
      status: error.status || err.status,
      message: error.message || err.message,
    });
  }

  // Fallback generic 500 error
  const statusCode = error.statusCode || err.statusCode || 500;
  const message = error.message || err.message || "Internal Server Error";

  res.status(statusCode).json({
    status: "error",
    message,
  });
};

module.exports = errorMiddleware;
