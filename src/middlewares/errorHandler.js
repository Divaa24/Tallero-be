import { AppError, NotFoundError } from "../utils/errors.js";
import { sendError } from "../utils/response.js";
import logger from "../config/logger.js";

/**
 * Middleware 404 untuk rute yang tidak terdaftar
 */
export const notFoundHandler = (req, res, next) => {
  next(new NotFoundError(`Rute ${req.method} ${req.originalUrl} tidak ditemukan pada server`));
};

/**
 * Global Centralized Error Handling Middleware
 * Menangani AppError, Zod, Multer, Prisma (P2002, P2025, P2003), JWT, JSON syntax, dan INTERNAL_ERROR
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return sendError(res, {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  if (err.name === "ZodError" || Array.isArray(err.issues)) {
    const details = (err.issues || []).map((issue) => ({
      field: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    }));

    return sendError(res, {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Validasi data masukan gagal",
      details,
    });
  }

  if (err.name === "MulterError") {
    let message = "Terjadi kesalahan saat mengunggah berkas";
    if (err.code === "LIMIT_FILE_SIZE") {
      message = "Ukuran berkas melebihi batas maksimal yang diizinkan";
    }

    return sendError(res, {
      statusCode: 400,
      code: `UPLOAD_${err.code}`,
      message,
      details: { field: err.field },
    });
  }

  if (err.code && typeof err.code === "string" && err.code.startsWith("P")) {
    if (err.code === "P2002") {
      const target = err.meta?.target || "field";
      return sendError(res, {
        statusCode: 409,
        code: "DUPLICATE_RESOURCE",
        message: `Data dengan ${Array.isArray(target) ? target.join(", ") : target} tersebut sudah ada`,
        details: err.meta,
      });
    }

    if (err.code === "P2025") {
      return sendError(res, {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Data yang dicari tidak ditemukan pada database",
      });
    }

    if (err.code === "P2003") {
      return sendError(res, {
        statusCode: 409,
        code: "FOREIGN_KEY_VIOLATION",
        message: "Operasi gagal karena relasi data terkait tidak valid atau dibatasi",
      });
    }
  }

  if (err.name === "JsonWebTokenError") {
    return sendError(res, {
      statusCode: 401,
      code: "INVALID_TOKEN",
      message: "Token otentikasi tidak valid atau telah rusak",
    });
  }

  if (err.name === "TokenExpiredError") {
    return sendError(res, {
      statusCode: 401,
      code: "TOKEN_EXPIRED",
      message: "Token otentikasi telah kedaluwarsa. Silakan lakukan refresh atau login kembali.",
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return sendError(res, {
      statusCode: 400,
      code: "INVALID_JSON_BODY",
      message: "Format JSON pada request body tidak valid",
    });
  }

  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        name: err.name,
      },
      reqId: req.id,
      method: req.method,
      url: req.originalUrl,
    },
    "Unhandled Internal Server Error"
  );

  return sendError(res, {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Terjadi kesalahan internal pada server",
  });
};

export default errorHandler;
