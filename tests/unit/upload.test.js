import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { uploadSingleImage } from "../../src/middlewares/upload.js";
import {
  removeAvatarFile,
  resolveSignedPrivateFile,
  saveProcessedAvatar,
} from "../../src/services/files.service.js";
import { createSignedUrl } from "../../src/utils/signedUrl.js";

const buildMultipartRequest = ({
  fieldName = "file",
  filename = "photo.jpg",
  mime = "image/jpeg",
  contentBuffer,
}) => {
  const boundary = "----TalleroTestBoundary123";
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
    "utf8"
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const fullBody = Buffer.concat([header, contentBuffer, footer]);

  const stream = new PassThrough();
  stream.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(fullBody.length),
  };
  stream.end(fullBody);
  return stream;
};

const runUploadMiddleware = (req) =>
  new Promise((resolve, reject) => {
    uploadSingleImage(req, {}, (err) => {
      if (err) reject(err);
      else resolve(req.file);
    });
  });

describe("upload middleware & files.service", () => {
  const tempDirs = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects spoofed extension with non-image magic bytes (PDF/SVG bytes disguised as .jpg)", async () => {
    const fakeJpgWithPdfBytes = Buffer.from("%PDF-1.4\n%fake payload", "utf8");
    const req = buildMultipartRequest({
      fieldName: "avatar",
      filename: "avatar.jpg",
      mime: "image/jpeg",
      contentBuffer: fakeJpgWithPdfBytes,
    });

    await expect(runUploadMiddleware(req)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_FILE_TYPE",
    });

    const svgPayload = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
      "utf8"
    );
    const svgReq = buildMultipartRequest({
      fieldName: "file",
      filename: "exploit.png",
      mime: "image/png",
      contentBuffer: svgPayload,
    });

    await expect(runUploadMiddleware(svgReq)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_FILE_TYPE",
    });

    // Uji file PHP berkedok ekstensi .jpg via field 'photo' (magic bytes checking)
    const phpPayload = Buffer.from("<?php echo 'hacked'; ?>", "utf8");
    const phpReq = buildMultipartRequest({
      fieldName: "photo",
      filename: "shell.jpg",
      mime: "image/jpeg",
      contentBuffer: phpPayload,
    });

    await expect(runUploadMiddleware(phpReq)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_FILE_TYPE",
    });
  });

  it("accepts real PNG/JPEG bytes, converts to WebP <= 1920px without EXIF, and resolves via signed URL", async () => {
    const pngBuffer = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: { r: 20, g: 120, b: 200 } },
    })
      .jpeg({ quality: 85 })
      .withMetadata({ exif: { IFD0: { Make: "SecretCameraModel" } } })
      .toBuffer();

    const req = buildMultipartRequest({
      fieldName: "avatar",
      filename: "real.jpg",
      mime: "image/jpeg",
      contentBuffer: pngBuffer,
    });

    const uploadedFile = await runUploadMiddleware(req);
    expect(uploadedFile.detectedMime).toBe("image/jpeg");

    const tempStorage = await fs.mkdtemp(path.join(os.tmpdir(), "tallero-avatars-"));
    tempDirs.push(tempStorage);

    const saved = await saveProcessedAvatar(uploadedFile.buffer, tempStorage);
    expect(saved.mimeType).toBe("image/webp");
    expect(saved.avatarKey).toMatch(/^[a-f0-9-]+$/);

    const outputBytes = await fs.readFile(saved.filePath);
    const metadata = await sharp(outputBytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(960);
    expect(metadata.exif).toBeUndefined();

    const signed = createSignedUrl({ kind: "avatar", id: saved.avatarKey, ttlSec: 300 });
    const parsed = new URL(signed.url, "http://localhost");
    const resolved = await resolveSignedPrivateFile(
      {
        kind: "avatar",
        id: saved.avatarKey,
        exp: Number(parsed.searchParams.get("exp")),
        sig: parsed.searchParams.get("sig"),
      },
      tempStorage
    );
    expect(resolved.filePath).toBe(saved.filePath);
    expect(resolved.contentType).toBe("image/webp");

    await expect(
      resolveSignedPrivateFile(
        {
          kind: "avatar",
          id: saved.avatarKey,
          exp: Number(parsed.searchParams.get("exp")),
          sig: "0".repeat(64),
        },
        tempStorage
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "INVALID_SIGNED_URL" });

    await removeAvatarFile(saved.avatarKey, tempStorage);
    await expect(fs.access(saved.filePath)).rejects.toThrow();
  });
});
