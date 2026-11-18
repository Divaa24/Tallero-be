import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables dari .env
dotenv.config();

const envSchema = z
  .object({
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(5000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    LOG_SQL_QUERIES: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
    TEST_DATABASE_URL: z.string().optional(),

    JWT_SECRET: z.string().min(32, "JWT_SECRET wajib diisi dan minimal 32 karakter"),
    SIGNED_URL_SECRET: z.string().min(32, "SIGNED_URL_SECRET wajib diisi dan minimal 32 karakter"),
    OTP_HMAC_SECRET: z.string().min(32, "OTP_HMAC_SECRET wajib diisi dan minimal 32 karakter"),

    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173,http://localhost:3000")
      .transform((val) =>
        val
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),

    // Konfigurasi Cookie Refresh Token Web (AGENTS.md §4.6)
    COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("lax"),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_PATH: z.string().default("/api/v1/auth"),
    COOKIE_SECURE: z
      .union([z.boolean(), z.string()])
      .transform((val) => val === true || val === "true")
      .optional(),

    WEB_URL: z
      .string()
      .url("WEB_URL harus berupa URL valid (mis. http://localhost:5173)")
      .default("http://localhost:3000"),
    MOBILE_DEEP_LINK: z.string().min(1, "MOBILE_DEEP_LINK wajib diisi").default("tallero://"),

    EMAIL_DRIVER: z.enum(["console", "gmail"]).default("console"),
    GMAIL_CLIENT_ID: z.string().optional(),
    GMAIL_CLIENT_SECRET: z.string().optional(),
    GMAIL_REFRESH_TOKEN: z.string().optional(),
    GMAIL_USER: z.string().email("GMAIL_USER harus berupa email valid").optional(),

    MIDTRANS_SERVER_KEY: z.string().min(1, "MIDTRANS_SERVER_KEY wajib diisi"),
    MIDTRANS_CLIENT_KEY: z.string().min(1, "MIDTRANS_CLIENT_KEY wajib diisi"),
    MIDTRANS_IS_PRODUCTION: z
      .union([z.boolean(), z.string()])
      .transform((val) => val === true || val === "true")
      .default(false),

    ENABLE_JOBS: z
      .union([z.boolean(), z.string()])
      .transform((val) => val === true || val === "true")
      .default(false),

    TRUST_PROXY: z
      .union([z.boolean(), z.string(), z.number()])
      .transform((val) => {
        if (typeof val === "boolean") return val;
        if (val === "true") return true;
        if (val === "false") return false;
        const num = Number(val);
        return Number.isNaN(num) ? val : num;
      })
      .default(false),

    // Seed admin awal (opsional saat runtime, wajib saat menjalankan prisma/seed.js)
    SEED_ADMIN_NAME: z.string().optional(),
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
    SEED_ADMIN_PHONE: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "test" && (!data.TEST_DATABASE_URL || !data.TEST_DATABASE_URL.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_DATABASE_URL"],
        message:
          "TEST_DATABASE_URL wajib diisi ketika NODE_ENV='test' agar tes tidak menyentuh DB dev",
      });
    }

    if (data.TEST_DATABASE_URL && data.DATABASE_URL) {
      try {
        const dev = new URL(data.DATABASE_URL);
        const test = new URL(data.TEST_DATABASE_URL);
        const host = (url) =>
          ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
            ? "loopback"
            : url.hostname.toLowerCase();
        if (
          host(dev) === host(test) &&
          (dev.port || "5432") === (test.port || "5432") &&
          decodeURIComponent(dev.pathname) === decodeURIComponent(test.pathname)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["TEST_DATABASE_URL"],
            message:
              "Database test wajib berbeda dari database development (termasuk schema berbeda)",
          });
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["TEST_DATABASE_URL"],
          message: "URL database tidak valid",
        });
      }
    }

    if (data.NODE_ENV === "production" && data.EMAIL_DRIVER === "console") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_DRIVER"],
        message: "EMAIL_DRIVER='console' dilarang di environment production. Gunakan 'gmail'.",
      });
    }

    if (data.EMAIL_DRIVER === "gmail") {
      const requiredGmailFields = [
        "GMAIL_CLIENT_ID",
        "GMAIL_CLIENT_SECRET",
        "GMAIL_REFRESH_TOKEN",
        "GMAIL_USER",
      ];
      for (const field of requiredGmailFields) {
        if (!data[field] || String(data[field]).trim().length === 0) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} wajib diisi ketika EMAIL_DRIVER='gmail'`,
          });
        }
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("\n❌ ========================================================");
  console.error("❌ KESALAHAN KONFIGURASI ENVIRONMENT (.env):");
  console.error("❌ Aplikasi gagal start karena variabel wajib berikut bermasalah:");
  for (const issue of parsed.error.issues) {
    console.error(`   - [${issue.path.join(".")}]: ${issue.message}`);
  }
  console.error("❌ ========================================================\n");
  process.exit(1);
}

export const env = parsed.data;
export default env;
