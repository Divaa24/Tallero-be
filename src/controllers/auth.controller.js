import env from "../config/env.js";
import RULES from "../config/rules.js";
import { sendSuccess } from "../utils/response.js";
import * as registrationOtp from "../services/registrationOtp.service.js";
import * as authService from "../services/auth.service.js";
import * as sessionTokens from "../services/sessionTokens.service.js";

export const REFRESH_COOKIE_NAME = "refreshToken";

export const isWebClient = (req) => req.get("x-client")?.toLowerCase() === "web";

export const buildRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE : env.NODE_ENV === "production",
  sameSite: env.COOKIE_SAME_SITE || (env.NODE_ENV === "production" ? "strict" : "lax"),
  path: env.COOKIE_PATH || "/api/v1/auth",
  domain: env.COOKIE_DOMAIN || undefined,
  maxAge: RULES.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
});

export const clearRefreshCookie = (res) => {
  const { maxAge: _ignored, ...clearOptions } = buildRefreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
};

const extractClientMeta = (req) => ({
  userAgent: req.get("user-agent") || null,
  ip: req.ip || null,
});

const sendSessionResponse = (req, res, sessionData) => {
  const web = isWebClient(req);
  if (web) {
    res.cookie(REFRESH_COOKIE_NAME, sessionData.refreshToken, buildRefreshCookieOptions());
    const { refreshToken: _omitted, ...safePayload } = sessionData;
    return sendSuccess(res, { data: safePayload });
  }

  return sendSuccess(res, { data: sessionData });
};

export const register = async (req, res) => {
  const data = await registrationOtp.register(req.valid.body);
  return sendSuccess(res, { data });
};

export const verifyOtp = async (req, res) => {
  const data = await registrationOtp.verifyOtp({
    ...req.valid.body,
    meta: extractClientMeta(req),
  });
  return sendSessionResponse(req, res, data);
};

export const resendOtp = async (req, res) => {
  const data = await registrationOtp.resendOtp(req.valid.body);
  return sendSuccess(res, { data });
};

export const login = async (req, res) => {
  const data = await authService.login({
    ...req.valid.body,
    meta: extractClientMeta(req),
  });
  return sendSessionResponse(req, res, data);
};

export const refresh = async (req, res) => {
  const rawRefreshToken =
    req.cookies?.[REFRESH_COOKIE_NAME] || req.valid?.body?.refreshToken || null;

  const data = await sessionTokens.rotateRefreshToken({
    rawRefreshToken,
    ...extractClientMeta(req),
  });

  return sendSessionResponse(req, res, data);
};

export const logout = async (req, res) => {
  const rawRefreshToken =
    req.cookies?.[REFRESH_COOKIE_NAME] || req.valid?.body?.refreshToken || null;

  await sessionTokens.revokeSingleRefreshToken({ rawRefreshToken });
  clearRefreshCookie(res);

  return sendSuccess(res, { data: { message: "Logout berhasil" } });
};

export const logoutAll = async (req, res) => {
  await sessionTokens.revokeAllUserSessions({
    userId: req.user.id,
    incrementTokenVersion: true,
  });
  clearRefreshCookie(res);

  return sendSuccess(res, {
    data: { message: "Seluruh sesi aktif berhasil dihentikan" },
  });
};

export const forgotPassword = async (req, res) => {
  const data = await authService.forgotPassword(req.valid.body);
  return sendSuccess(res, { data });
};

export const resetPassword = async (req, res) => {
  const data = await authService.resetPassword(req.valid.body);
  clearRefreshCookie(res);
  return sendSuccess(res, { data });
};

export const changePassword = async (req, res) => {
  const data = await authService.changePassword({
    actor: req.user,
    ...req.valid.body,
  });
  clearRefreshCookie(res);
  return sendSuccess(res, { data });
};

export const getMe = async (req, res) => {
  const data = await authService.getMe({ actor: req.user });
  return sendSuccess(res, { data });
};

export const updateMe = async (req, res) => {
  const data = await authService.updateMe({
    actor: req.user,
    data: req.valid.body,
  });
  return sendSuccess(res, { data });
};

export const uploadAvatar = async (req, res) => {
  const data = await authService.updateAvatar({
    actor: req.user,
    buffer: req.file.buffer,
  });
  return sendSuccess(res, { data });
};
