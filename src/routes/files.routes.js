import { Router } from "express";
import validate from "../middlewares/validate.js";
import { signedFileSchema } from "../validations/auth.validation.js";
import { serveSignedFile } from "../controllers/files.controller.js";

const filesRouter = Router();

// Akses berkas privat diverifikasi oleh signed URL berumur pendek (exp + HMAC timingSafeEqual)
filesRouter.get("/:kind/:id", validate(signedFileSchema), serveSignedFile);

export default filesRouter;
