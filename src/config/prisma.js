import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import env from "./env.js";
import logger from "./logger.js";
import { ValidationError } from "../utils/errors.js";

// Model yang mendukung soft delete (AGENTS.md §5 & §7)
export const SOFT_DELETE_MODELS = new Set([
  "User",
  "Outlet",
  "Category",
  "Service",
  "Sparepart",
  "Vehicle",
  "BookingPhoto",
]);

const FILTERED_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
]);

const txStorage = new AsyncLocalStorage();

const injectDeletedAtNull = (where) => {
  if (!where) {
    return { deletedAt: null };
  }
  if (where.deletedAt !== undefined) {
    return where;
  }
  return { ...where, deletedAt: null };
};

/**
 * Builder murni handler operasi Prisma untuk soft delete (dapat di-unit-test secara terisolasi)
 * @param {{ getTargetClient: () => any }} options
 */
export const createSoftDeleteHandler = ({ getTargetClient }) => {
  return async ({ model, operation, args, query }) => {
    if (!model || !SOFT_DELETE_MODELS.has(model)) {
      return query(args);
    }

    if (FILTERED_OPERATIONS.has(operation)) {
      const nextArgs = {
        ...args,
        where: injectDeletedAtNull(args?.where),
      };
      return query(nextArgs);
    }

    if (operation === "delete" || operation === "deleteMany") {
      const delegate = model.charAt(0).toLowerCase() + model.slice(1);
      const targetClient = getTargetClient();
      const data = { deletedAt: new Date() };

      // Bebaskan plat kendaraan agar bisa didaftarkan ulang setelah soft-delete (AGENTS.md §5)
      if (model === "Vehicle") {
        data.activePlate = null;
      }

      const where = injectDeletedAtNull(args?.where);

      if (operation === "delete") {
        return targetClient[delegate].update({
          where,
          data,
          ...(args?.select ? { select: args.select } : {}),
          ...(args?.include ? { include: args.include } : {}),
        });
      }

      return targetClient[delegate].updateMany({
        where,
        data,
      });
    }

    return query(args);
  };
};

const connectionString =
  env.NODE_ENV === "test" && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL;

export const pool = new pg.Pool({ connectionString });

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL pool client error");
});

const adapter = new PrismaPg(pool);

// Base client: memiliki global omit untuk User.passwordHash, TANPA filter soft delete
const basePrisma = new PrismaClient({
  adapter,
  omit: {
    user: {
      passwordHash: true,
    },
  },
  log:
    env.NODE_ENV === "development"
      ? [
          ...(env.LOG_SQL_QUERIES ? [{ emit: "event", level: "query" }] : []),
          { emit: "event", level: "error" },
          { emit: "event", level: "info" },
          { emit: "event", level: "warn" },
        ]
      : [{ emit: "event", level: "error" }],
});

if (env.NODE_ENV === "development" && env.LOG_SQL_QUERIES) {
  basePrisma.$on("query", (e) => {
    logger.debug({ query: e.query, duration: `${e.duration}ms` }, "Prisma Query");
  });
}

basePrisma.$on("error", (e) => {
  logger.error({ message: e.message, target: e.target }, "Prisma Error");
});

const softDeleteHandler = createSoftDeleteHandler({
  getTargetClient: () => txStorage.getStore() || basePrisma,
});

const extendedPrisma = basePrisma.$extends({
  name: "soft-delete-extension",
  query: {
    $allModels: {
      $allOperations: softDeleteHandler,
    },
  },
});

// Bungkus $transaction interaktif agar delete -> update berjalan di dalam koneksi tx yang sama
export const prisma = new Proxy(extendedPrisma, {
  get(target, prop, receiver) {
    if (prop === "$transaction") {
      return (arg, options) => {
        if (typeof arg === "function") {
          return target.$transaction((tx) => txStorage.run(tx, () => arg(tx)), options);
        }
        return target.$transaction(arg, options);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});

/**
 * Helper eksplisit untuk admin/restore agar dapat melihat & memulihkan record yang di-soft-delete.
 * Tetap menerapkan global omit passwordHash pada User.
 */
export const withDeleted = basePrisma;

/**
 * Mengunci baris outlet di dalam transaksi untuk mencegah race condition slot/antrian (AGENTS.md §8)
 * Menggunakan tagged template $queryRaw ber-parameter agar aman dari SQL injection.
 */
export const lockOutlet = async (tx, outletId) => {
  if (!tx || typeof tx.$queryRaw !== "function") {
    throw new TypeError("lockOutlet membutuhkan Prisma transaction client (tx) yang valid");
  }

  const id = Number(outletId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("outletId tidak valid untuk lock transaksi");
  }

  const rows = await tx.$queryRaw`SELECT id FROM outlets WHERE id = ${id} FOR UPDATE`;
  return rows[0] ?? null;
};

export const lockCustomer = async (tx, customerId) => {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${customerId} FOR UPDATE`;
};

export const lockBooking = async (tx, bookingId) => {
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
};

export const lockInvoices = async (tx) => {
  // Invoice numbering spans every outlet; hold the shared lock until commit.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(1844001)`;
};

export default prisma;
