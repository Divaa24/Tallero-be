// ==============================================================================
// TALLERO AUTO — STANDAR RESPONSE API
// Sesuai konvensi AGENTS.md §3:
// Sukses: { "success": true, "data": ..., "meta": { page, limit, total, totalPages }? }
// Gagal:  { "success": false, "error": { "code", "message", "details"? } }
// ==============================================================================

export const sendSuccess = (res, { data = null, meta = null, statusCode = 200 } = {}) => {
  const payload = {
    success: true,
    data,
  };

  if (meta !== null && meta !== undefined) {
    payload.meta = meta;
  }

  return res.status(statusCode).json(payload);
};

export const sendError = (
  res,
  {
    code = "INTERNAL_ERROR",
    message = "Terjadi kesalahan pada server",
    details = null,
    statusCode = 500,
  } = {}
) => {
  const payload = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details !== null && details !== undefined) {
    payload.error.details = details;
  }

  return res.status(statusCode).json(payload);
};

export default {
  sendSuccess,
  sendError,
};
