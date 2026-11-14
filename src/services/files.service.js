import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import prisma from "../config/prisma.js";
import RULES from "../config/rules.js";
import logger from "../config/logger.js";
import { verifySignedUrl } from "../utils/signedUrl.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";

export const PRIVATE_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "private");
export const AVATARS_STORAGE_DIR = path.resolve(PRIVATE_STORAGE_ROOT, "avatars");
export const BOOKING_PHOTOS_STORAGE_DIR = path.resolve(PRIVATE_STORAGE_ROOT, "booking-photos");
const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Mengonversi buffer gambar avatar ke WebP (maks 1920px, EXIF/GPS dihapus) dan menyimpannya ke storage privat.
 */
export const saveProcessedAvatar = async (buffer, storageDir = AVATARS_STORAGE_DIR) => {
  await fs.mkdir(storageDir, { recursive: true });

  const avatarKey = crypto.randomUUID();
  const filePath = path.join(storageDir, `${avatarKey}.webp`);

  const processedBuffer = await sharp(buffer)
    .rotate()
    .resize(RULES.MAX_IMAGE_DIMENSION_PX, RULES.MAX_IMAGE_DIMENSION_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();

  await fs.writeFile(filePath, processedBuffer);

  return {
    avatarKey,
    filePath,
    sizeBytes: processedBuffer.length,
    mimeType: "image/webp",
  };
};

/**
 * Mengonversi buffer foto booking ke WebP (maks 1920px, metadata dihapus) dan menyimpannya di folder booking terkait.
 */
export const saveProcessedBookingPhoto = async (
  buffer,
  bookingId,
  storageDir = BOOKING_PHOTOS_STORAGE_DIR
) => {
  const bookingFolder = path.join(storageDir, String(bookingId));
  await fs.mkdir(bookingFolder, { recursive: true });

  const photoUuid = crypto.randomUUID();
  const filePath = path.join(bookingFolder, `${photoUuid}.webp`);
  const storageKey = `booking-photos/${bookingId}/${photoUuid}.webp`;

  const processedBuffer = await sharp(buffer)
    .rotate()
    .resize(RULES.MAX_IMAGE_DIMENSION_PX, RULES.MAX_IMAGE_DIMENSION_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();

  await fs.writeFile(filePath, processedBuffer);

  return {
    storageKey,
    filePath,
    sizeBytes: processedBuffer.length,
    mimeType: "image/webp",
  };
};

/**
 * Menghapus file avatar lama secara aman (best-effort, tidak menggagalkan request utama).
 */
export const removeAvatarFile = async (avatarKey, storageDir = AVATARS_STORAGE_DIR) => {
  if (!avatarKey || !SAFE_SEGMENT_REGEX.test(avatarKey)) {
    return;
  }

  const targetPath = path.resolve(storageDir, `${avatarKey}.webp`);
  const resolvedRoot = path.resolve(storageDir);
  if (!targetPath.startsWith(resolvedRoot + path.sep)) {
    return;
  }

  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger.warn({ err: error, avatarKey }, "Gagal menghapus berkas avatar lama");
    }
  }
};

/**
 * Memverifikasi signed URL (exp + sig via timingSafeEqual) dan memetakan ke path file privat yang aman.
 */
export const resolveSignedPrivateFile = async (
  { kind, id, exp, sig },
  storageDir = AVATARS_STORAGE_DIR
) => {
  const verification = verifySignedUrl({ kind, id, exp, sig });
  if (!verification.valid) {
    const code = verification.reason === "EXPIRED" ? "SIGNED_URL_EXPIRED" : "INVALID_SIGNED_URL";
    const message =
      verification.reason === "EXPIRED"
        ? "Tautan berkas telah kedaluwarsa"
        : "Tautan berkas tidak valid";
    throw new ForbiddenError(message, code);
  }

  if (kind !== "avatar" && kind !== "booking-photo") {
    throw new NotFoundError("Jenis berkas tidak ditemukan", "FILE_NOT_FOUND");
  }

  let targetPath;
  if (kind === "avatar") {
    const resolvedRoot = path.resolve(storageDir);
    targetPath = path.resolve(resolvedRoot, `${id}.webp`);
    if (!targetPath.startsWith(resolvedRoot + path.sep)) {
      throw new ForbiddenError("Akses path berkas tidak diizinkan", "INVALID_FILE_PATH");
    }
  } else if (kind === "booking-photo") {
    const photo = await prisma.bookingPhoto.findFirst({
      where: { id: Number(id), deletedAt: null },
    });
    if (!photo) {
      throw new NotFoundError("Foto booking tidak ditemukan", "FILE_NOT_FOUND");
    }
    const resolvedRoot = path.resolve(PRIVATE_STORAGE_ROOT);
    targetPath = path.resolve(resolvedRoot, photo.storageKey);
    if (!targetPath.startsWith(resolvedRoot + path.sep)) {
      throw new ForbiddenError("Akses path berkas tidak diizinkan", "INVALID_FILE_PATH");
    }
  }

  try {
    await fs.access(targetPath);
  } catch {
    throw new NotFoundError("Berkas tidak ditemukan", "FILE_NOT_FOUND");
  }

  return {
    filePath: targetPath,
    contentType: "image/webp",
  };
};

export default {
  PRIVATE_STORAGE_ROOT,
  AVATARS_STORAGE_DIR,
  BOOKING_PHOTOS_STORAGE_DIR,
  saveProcessedAvatar,
  saveProcessedBookingPhoto,
  removeAvatarFile,
  resolveSignedPrivateFile,
};
