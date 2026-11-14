import env from "../config/env.js";
import RULES from "../config/rules.js";
import { hmacSha256, safeCompare } from "./crypto.js";

// Hanya izinkan karakter aman untuk mencegah path traversal
const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/;

const assertSafeSegment = (value, label) => {
  const str = String(value ?? "");
  if (!str || !SAFE_SEGMENT_REGEX.test(str)) {
    throw new TypeError(`${label} mengandung karakter tidak valid atau berpotensi path traversal`);
  }
  return str;
};

const buildSignaturePayload = ({ kind, id, exp }) => `${kind}:${id}:${exp}`;

/**
 * Membuat parameter dan URL bertanda tangan (signed URL) berumur pendek
 */
export const createSignedUrl = ({
  kind,
  id,
  ttlSec = RULES.SIGNED_URL_TTL_SEC,
  baseUrl = "/api/v1/files",
  nowMs = Date.now(),
}) => {
  const safeKind = assertSafeSegment(kind, "kind");
  const safeId = assertSafeSegment(id, "id");

  if (!Number.isFinite(ttlSec)) {
    throw new TypeError("ttlSec harus berupa angka valid");
  }

  const exp = Math.floor(nowMs / 1000) + Math.floor(ttlSec);
  const payload = buildSignaturePayload({ kind: safeKind, id: safeId, exp });
  const sig = hmacSha256(payload, env.SIGNED_URL_SECRET);
  const url = `${baseUrl}/${encodeURIComponent(safeKind)}/${encodeURIComponent(safeId)}?exp=${exp}&sig=${sig}`;

  return { exp, sig, url };
};

/**
 * Memverifikasi parameter signed URL (exp & sig) menggunakan timingSafeEqual
 */
export const verifySignedUrl = ({ kind, id, exp, sig, nowMs = Date.now() }) => {
  if (!sig || typeof sig !== "string") {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  let safeKind;
  let safeId;
  try {
    safeKind = assertSafeSegment(kind, "kind");
    safeId = assertSafeSegment(id, "id");
  } catch {
    return { valid: false, reason: "INVALID_PARAMS" };
  }

  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum <= 0) {
    return { valid: false, reason: "INVALID_EXP" };
  }

  const payload = buildSignaturePayload({ kind: safeKind, id: safeId, exp: expNum });
  const expectedSig = hmacSha256(payload, env.SIGNED_URL_SECRET);

  if (!safeCompare(sig, expectedSig)) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  const nowSec = Math.floor(nowMs / 1000);
  if (nowSec >= expNum) {
    return { valid: false, reason: "EXPIRED" };
  }

  return { valid: true, exp: expNum };
};

export default {
  createSignedUrl,
  verifySignedUrl,
};
