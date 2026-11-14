import { resolveSignedPrivateFile } from "../services/files.service.js";

export const serveSignedFile = async (req, res) => {
  const { kind, id } = req.valid.params;
  const { exp, sig } = req.valid.query;

  const { filePath, contentType } = await resolveSignedPrivateFile({ kind, id, exp, sig });

  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "private, max-age=300");

  return res.sendFile(filePath);
};

export default {
  serveSignedFile,
};
