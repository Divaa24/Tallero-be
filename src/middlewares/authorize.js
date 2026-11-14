import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

const buildRoleChecker = ({ allowMustChangePassword }, ...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new UnauthorizedError("Autentikasi diperlukan", "UNAUTHORIZED");
    }

    if (!allowMustChangePassword && req.user.mustChangePassword) {
      throw new ForbiddenError(
        "Anda wajib mengganti password sementara sebelum mengakses fitur ini",
        "PASSWORD_CHANGE_REQUIRED"
      );
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(
        "Anda tidak memiliki izin untuk mengakses resource ini",
        "FORBIDDEN"
      );
    }

    next();
  };
};

/**
 * Middleware otorisasi standar. Menolak akun yang masih berstatus mustChangePassword.
 * @param  {...string} allowedRoles
 */
export const authorize = (...allowedRoles) =>
  buildRoleChecker({ allowMustChangePassword: false }, ...allowedRoles);

/**
 * Middleware otorisasi khusus endpoint yang memang dibutuhkan saat user masih wajib ganti password
 * (mis. /auth/change-password, /auth/logout, /auth/logout-all, GET /auth/me).
 * @param  {...string} allowedRoles
 */
export const authorizePasswordChangeAllowed = (...allowedRoles) =>
  buildRoleChecker({ allowMustChangePassword: true }, ...allowedRoles);

export default authorize;
