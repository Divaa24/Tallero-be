// ==============================================================================
// TALLERO AUTO — VALIDASI SKEMA (ZOD)
// Aturan AGENTS.md §3:
// - Hasil parsing disimpan di `req.valid = { body, query, params }`
// - JANGAN assign ke `req.query` (Express 5 query bersifat read-only)
// - Body Zod memakai `.strict()` (anti mass-assignment)
// - Pakai `error.issues`, bukan `error.errors`
// ==============================================================================

import { ValidationError } from "../utils/errors.js";

const formatIssues = (location, issues) =>
  issues.map((issue) => ({
    location,
    field: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));

/**
 * Middleware factory untuk validasi request menggunakan skema Zod.
 * Mendukung format objek { body?, query?, params? } maupun (schema, target).
 * @param {Object} schemas - { body?, query?, params? } atau ZodSchema langsung
 * @param {"body"|"query"|"params"} [target] - target jika schemas adalah ZodSchema tunggal
 */
export const validate = (schemas = {}, target) => {
  const normalizedSchemas = target
    ? { [target]: schemas }
    : schemas.safeParse
      ? { body: schemas }
      : schemas;

  return (req, res, next) => {
    try {
      const valid = { ...req.valid };
      const validationErrors = [];

      if (normalizedSchemas.params) {
        const result = normalizedSchemas.params.safeParse(req.params);
        if (!result.success) {
          validationErrors.push(...formatIssues("params", result.error.issues));
        } else {
          valid.params = result.data;
        }
      } else {
        valid.params ??= req.params;
      }

      // Express 5 req.query bersifat read-only; jangan pernah di-overwrite
      if (normalizedSchemas.query) {
        const result = normalizedSchemas.query.safeParse(req.query);
        if (!result.success) {
          validationErrors.push(...formatIssues("query", result.error.issues));
        } else {
          valid.query = result.data;
        }
      } else {
        valid.query ??= req.query;
      }

      if (normalizedSchemas.body) {
        let bodySchema = normalizedSchemas.body;
        if (typeof bodySchema.strict === "function") {
          bodySchema = bodySchema.strict();
        }

        const result = bodySchema.safeParse(req.body);
        if (!result.success) {
          validationErrors.push(...formatIssues("body", result.error.issues));
        } else {
          valid.body = result.data;
        }
      } else {
        valid.body ??= req.body;
      }

      if (validationErrors.length > 0) {
        return next(new ValidationError("Validasi data masukan gagal", validationErrors));
      }

      req.valid = valid;
      return next();
    } catch (err) {
      return next(err);
    }
  };
};

export default validate;
