// ==============================================================================
// TALLERO AUTO — APPLICATION ERROR CLASSES
// Sesuai konvensi API AGENTS.md §3
// ==============================================================================

export class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR", details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validasi input gagal", details = null, code = "VALIDATION_ERROR") {
    super(message, 400, code, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Permintaan tidak valid", code = "BAD_REQUEST", details = null) {
    super(message, 400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = "Autentikasi diperlukan atau token tidak valid",
    code = "UNAUTHORIZED",
    details = null
  ) {
    super(message, 401, code, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = "Anda tidak memiliki izin untuk melakukan aksi ini",
    code = "FORBIDDEN",
    details = null
  ) {
    super(message, 403, code, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Data yang diminta tidak ditemukan", code = "NOT_FOUND", details = null) {
    super(message, 404, code, details);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = "Terjadi konflik data atau state tidak sesuai",
    code = "CONFLICT",
    details = null
  ) {
    super(message, 409, code, details);
  }
}

export class BusinessRuleError extends AppError {
  constructor(
    message = "Permintaan melanggar aturan bisnis",
    code = "BUSINESS_RULE_VIOLATION",
    details = null
  ) {
    super(message, 422, code, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    message = "Terlalu banyak permintaan. Silakan tunggu beberapa saat.",
    code = "TOO_MANY_REQUESTS",
    details = null
  ) {
    super(message, 429, code, details);
  }
}

export class BadGatewayError extends AppError {
  constructor(
    message = "Layanan eksternal gagal memproses permintaan.",
    code = "BAD_GATEWAY",
    details = null
  ) {
    super(message, 502, code, details);
  }
}
