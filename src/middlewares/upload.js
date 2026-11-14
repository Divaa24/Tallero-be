import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import RULES from "../config/rules.js";
import { BadRequestError } from "../utils/errors.js";

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: RULES.MAX_FILE_SIZE_BYTES,
    files: 1,
  },
});

const parseUploadedFields = memoryUpload.fields([
  { name: "file", maxCount: 1 },
  { name: "avatar", maxCount: 1 },
  { name: "photo", maxCount: 1 },
]);

/**
 * Middleware upload satu file gambar menggunakan memoryStorage dan validasi magic bytes via file-type.
 * Tidak mempercayai header Content-Type atau ekstensi nama file asli dari client.
 */
export const uploadSingleImage = (req, res, next) => {
  parseUploadedFields(req, res, async (multerErr) => {
    if (multerErr) {
      return next(multerErr);
    }

    try {
      const filesMap = req.files || {};
      const allFiles = [
        ...(filesMap.file || []),
        ...(filesMap.avatar || []),
        ...(filesMap.photo || []),
      ];

      if (allFiles.length === 0) {
        throw new BadRequestError(
          "Berkas gambar wajib diunggah melalui field 'photo', 'avatar', atau 'file'",
          "FILE_REQUIRED"
        );
      }

      if (allFiles.length > 1) {
        throw new BadRequestError(
          "Hanya satu berkas gambar yang dapat diunggah dalam satu permintaan",
          "TOO_MANY_FILES"
        );
      }

      const file = allFiles[0];
      if (!file.buffer || file.buffer.length === 0) {
        throw new BadRequestError("Berkas gambar kosong atau rusak", "EMPTY_FILE");
      }

      const detected = await fileTypeFromBuffer(file.buffer);
      if (!detected || !ALLOWED_IMAGE_MIME_TYPES.has(detected.mime)) {
        throw new BadRequestError(
          "Format berkas tidak valid. Hanya gambar JPEG, PNG, atau WebP yang diizinkan",
          "INVALID_FILE_TYPE"
        );
      }

      req.file = {
        fieldname: file.fieldname,
        originalname: file.originalname,
        encoding: file.encoding,
        mimetype: detected.mime,
        detectedMime: detected.mime,
        buffer: file.buffer,
        size: file.buffer.length,
      };

      return next();
    } catch (error) {
      return next(error);
    }
  });
};

uploadSingleImage.uploadSingleImage = uploadSingleImage;
export default uploadSingleImage;
