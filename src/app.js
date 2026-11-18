import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import fs from "node:fs";
import swaggerUi from "swagger-ui-express";

import env from "./config/env.js";
import logger from "./config/logger.js";
import { ForbiddenError } from "./utils/errors.js";
import requestId from "./middlewares/requestId.js";
import globalRateLimiter from "./middlewares/rateLimit.js";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";
import router from "./routes/index.js";

export const app = express();

// 1. Trust proxy jika diaktifkan (AGENTS.md §4.20)
if (env.TRUST_PROXY) {
  app.set("trust proxy", env.TRUST_PROXY);
}

// 2. Request ID Middleware
app.use(requestId);

// 3. Security Headers (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
    crossOriginEmbedderPolicy: false,
  })
);

// 4. CORS Whitelist
const corsOptions = {
  origin: (origin, callback) => {
    // Izinkan request tanpa origin (mobile apps native, curl) sesuai AGENTS.md §4.20
    if (!origin) {
      return callback(null, true);
    }
    if (env.CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new ForbiddenError(`Origin ${origin} tidak diizinkan oleh kebijakan CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Client"],
  exposedHeaders: ["Content-Disposition"],
  maxAge: 86400,
};
app.use(cors(corsOptions));

// 5. HTTP Logging (Pino)
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    autoLogging: env.NODE_ENV !== "test",
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  })
);

// 6. Body Parsers (limit 100 KB) & Cookie Parser
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

// 7. Global Rate Limiter
app.use("/api", globalRateLimiter);

// 8. Swagger UI Dokumentasi API di /docs (Hanya non-production, AGENTS.md §1)
if (env.NODE_ENV !== "production") {
  try {
    const openapiSpecPath = new URL("../docs/openapi.json", import.meta.url);
    if (fs.existsSync(openapiSpecPath)) {
      const openapiSpec = JSON.parse(fs.readFileSync(openapiSpecPath, "utf8"));
      app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
    }
  } catch (err) {
    logger.warn({ err }, "Gagal memuat Swagger UI di /docs");
  }
}

// 9. Mount API Router di /api/v1 (AGENTS.md §2 & §3)
app.use("/api/v1", router);

// 10. 404 & Centralized Error Handler
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
