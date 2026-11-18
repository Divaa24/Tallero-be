import pino from "pino";
import env from "./env.js";

const redactOptions = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    "authorization",
    "password",
    "temporaryPassword",
    "passwordHash",
    "token",
    "tokenHash",
    "refreshToken",
    "otp",
    "otpCode",
    "otpHash",
    "codeHash",
    "cookie",
    "*.password",
    "*.token",
    "*.otp",
    "*.cookie",
  ],
  censor: "[REDACTED]",
};

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  redact: redactOptions,
  transport:
    env.NODE_ENV !== "production" && env.NODE_ENV !== "test"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

export default logger;
