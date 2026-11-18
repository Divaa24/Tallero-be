// ==============================================================================
// TALLERO AUTO — DATABASE SEED SCRIPT (DEMO & TESTING)
// Sesuai AGENTS.md §1, §4, §5, §6, §7, §8
// Idempotent, Deterministik, & Menolak berjalan di production tanpa --force
// ==============================================================================

import { z } from "zod";
import env from "../src/config/env.js";
import logger from "../src/config/logger.js";
import { prisma, withDeleted, pool } from "../src/config/prisma.js";
import { hashPassword } from "../src/utils/crypto.js";
import { generateBookingQrPayload as createQrPayload } from "../src/services/bookings.service.js";
import { DateTime } from "luxon";
import RULES from "../src/config/rules.js";

// Skema validasi konfigurasi admin awal
const seedAdminSchema = z.object({
  SEED_ADMIN_NAME: z.string().trim().min(2, "SEED_ADMIN_NAME wajib diisi"),
  SEED_ADMIN_EMAIL: z
    .string()
    .trim()
    .email("SEED_ADMIN_EMAIL harus berupa email valid")
    .transform((val) => val.toLowerCase()),
  SEED_ADMIN_PASSWORD: z
    .string()
    .min(12, "SEED_ADMIN_PASSWORD wajib diisi minimal 12 karakter untuk keamanan"),
  SEED_ADMIN_PHONE: z
    .string()
    .trim()
    .min(8, "SEED_ADMIN_PHONE wajib diisi")
    .transform((val) => {
      const cleaned = val.replace(/[\s-]/g, "");
      if (cleaned.startsWith("0")) return `+62${cleaned.slice(1)}`;
      if (cleaned.startsWith("62")) return `+${cleaned}`;
      return cleaned;
    }),
});

/**
 * 1. Seed Initial Admin
 */
export async function seedInitialAdmin() {
  const parsed = seedAdminSchema.safeParse({
    SEED_ADMIN_NAME: env.SEED_ADMIN_NAME,
    SEED_ADMIN_EMAIL: env.SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD,
    SEED_ADMIN_PHONE: env.SEED_ADMIN_PHONE,
  });

  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues },
      "Konfigurasi SEED_ADMIN_* pada .env belum lengkap atau tidak valid"
    );
    throw new Error("SEED_ADMIN_* env tidak valid");
  }

  const { SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_PHONE } = parsed.data;

  const existing = await withDeleted.user.findUnique({
    where: { email: SEED_ADMIN_EMAIL },
  });

  if (existing) {
    return { created: false, user: existing };
  }

  const passwordHash = await hashPassword(SEED_ADMIN_PASSWORD);

  const admin = await prisma.user.create({
    data: {
      name: SEED_ADMIN_NAME,
      email: SEED_ADMIN_EMAIL,
      passwordHash,
      phone: SEED_ADMIN_PHONE,
      role: "ADMIN",
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
    },
  });

  return { created: true, user: admin };
}

/**
 * 2. Seed Demo Master Data & Transactions
 */
export async function seedDemoData() {
  const isForce = process.argv.includes("--force");
  if (process.env.NODE_ENV === "production" && !isForce) {
    throw new Error(
      "DITOLAK: Seed demo data tidak diizinkan berjalan di environment production tanpa argumen --force!"
    );
  }

  const demoPasswordMechanic = "MekanikTallero123!";
  const demoPasswordCustomer = "CustomerTallero123!";

  const [mechPasswordHash, custPasswordHash] = await Promise.all([
    hashPassword(demoPasswordMechanic),
    hashPassword(demoPasswordCustomer),
  ]);

  // A. Admin Utama
  const { user: admin } = await seedInitialAdmin();

  // B. 2 Outlet (Kapasitas & Jam berbeda)
  let outletBarat = await withDeleted.outlet.findFirst({
    where: { name: "Tallero Auto Cabang Barat" },
  });
  if (!outletBarat) {
    outletBarat = await prisma.outlet.create({
      data: {
        name: "Tallero Auto Cabang Barat",
        address: "Jl. Panjang No. 88, Kebon Jeruk, Jakarta Barat",
        phone: "+628119000101",
        latitude: -6.1852,
        longitude: 106.7712,
        openDays: [1, 2, 3, 4, 5, 6], // Senin - Sabtu
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 4,
        timezone: RULES.TIMEZONE,
        isActive: true,
      },
    });
  }

  let outletTimur = await withDeleted.outlet.findFirst({
    where: { name: "Tallero Auto Cabang Timur" },
  });
  if (!outletTimur) {
    outletTimur = await prisma.outlet.create({
      data: {
        name: "Tallero Auto Cabang Timur",
        address: "Jl. Raden Inten No. 45, Duren Sawit, Jakarta Timur",
        phone: "+628119000102",
        latitude: -6.2345,
        longitude: 106.9123,
        openDays: [1, 2, 3, 4, 5, 6, 7], // Setiap Hari
        openTime: "09:00",
        closeTime: "18:00",
        slotMinutes: 45,
        slotCapacity: 3,
        timezone: RULES.TIMEZONE,
        isActive: true,
      },
    });
  }

  // 1 Outlet Closure (Hari Libur Nasional di Outlet Barat)
  const closureDate = new Date("2026-12-25T00:00:00.000Z");
  const existingClosure = await prisma.outletClosure.findUnique({
    where: {
      outletId_date: {
        outletId: outletBarat.id,
        date: closureDate,
      },
    },
  });
  if (!existingClosure) {
    await prisma.outletClosure.create({
      data: {
        outletId: outletBarat.id,
        date: closureDate,
        reason: "Hari Raya Natal 2026",
      },
    });
  }

  // C. 4 Mekanik (2 di Cabang Barat, 2 di Cabang Timur)
  const mechanicsData = [
    {
      name: "Bambang Prakoso",
      email: "bambang.mekanik@tallero.test",
      phone: "+628121111001",
      outletId: outletBarat.id,
    },
    {
      name: "Joko Susilo",
      email: "joko.mekanik@tallero.test",
      phone: "+628121111002",
      outletId: outletBarat.id,
    },
    {
      name: "Dodi Kurniawan",
      email: "dodi.mekanik@tallero.test",
      phone: "+628121111003",
      outletId: outletTimur.id,
    },
    {
      name: "Hendra Wijaya",
      email: "hendra.mekanik@tallero.test",
      phone: "+628121111004",
      outletId: outletTimur.id,
    },
  ];

  const mechanics = [];
  for (const m of mechanicsData) {
    let user = await withDeleted.user.findUnique({ where: { email: m.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: m.name,
          email: m.email,
          passwordHash: mechPasswordHash,
          phone: m.phone,
          role: "MECHANIC",
          outletId: m.outletId,
          isActive: true,
          isVerified: true,
          mustChangePassword: false,
        },
      });
    }
    mechanics.push(user);
  }

  // D. 6 Customer Terverifikasi
  const customersData = [
    { name: "Ahmad Fadillah", email: "ahmad.customer@tallero.test", phone: "+628131000101" },
    { name: "Budi Santoso", email: "budi.customer@tallero.test", phone: "+628131000102" },
    { name: "Citra Lestari", email: "citra.customer@tallero.test", phone: "+628131000103" },
    { name: "Dewi Anggraini", email: "dewi.customer@tallero.test", phone: "+628131000104" },
    { name: "Eko Prasetyo", email: "eko.customer@tallero.test", phone: "+628131000105" },
    { name: "Fajar Nugraha", email: "fajar.customer@tallero.test", phone: "+628131000106" },
  ];

  const customers = [];
  for (const c of customersData) {
    let user = await withDeleted.user.findUnique({ where: { email: c.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: c.name,
          email: c.email,
          passwordHash: custPasswordHash,
          phone: c.phone,
          role: "CUSTOMER",
          isActive: true,
          isVerified: true,
          mustChangePassword: false,
        },
      });
    }
    customers.push(user);
  }

  // E. 6 Kategori Layanan
  const categoriesData = [
    { name: "Perawatan Berkala", description: "Servis rutin, tune-up, dan ganti oli" },
    { name: "Mesin & Transmisi", description: "Perbaikan komponen ruang mesin dan transmisi" },
    { name: "Rem & Kaki-kaki", description: "Pengecekan rem, suspensi, dan bearing roda" },
    { name: "Kelistrikan & AC", description: "Sistem pengisian aki, kelistrikan bodi, dan AC" },
    { name: "Ban & Spooring", description: "Balancing, rotasi, spooring dan tambal ban" },
    { name: "Detailing & Perawatan Bodi", description: "Cuci mobil hidrolik dan salon poles" },
  ];

  const categories = [];
  for (const cat of categoriesData) {
    let record = await withDeleted.category.findFirst({ where: { name: cat.name } });
    if (!record) {
      record = await prisma.category.create({ data: { name: cat.name } });
    }
    categories.push(record);
  }

  // F. 18 Layanan (Mobil & Motor, sebagian memiliki reminder interval)
  const servicesData = [
    // Kategori 0: Perawatan Berkala
    {
      categoryId: categories[0].id,
      name: "Tune Up Standar Mobil",
      description: "Pembersihan throttle body, busi, dan filter udara mobil",
      price: 250000,
      estimatedMinutes: 60,
      vehicleType: "CAR",
      reminderIntervalDays: 180,
      reminderIntervalKm: 10000,
    },
    {
      categoryId: categories[0].id,
      name: "Tune Up Injeksi Motor",
      description: "Reset ECU, pembersihan injector, dan cek busi motor",
      price: 85000,
      estimatedMinutes: 45,
      vehicleType: "MOTORCYCLE",
      reminderIntervalDays: 90,
      reminderIntervalKm: 4000,
    },
    {
      categoryId: categories[0].id,
      name: "Jasa Ganti Oli Mesin Mobil",
      description: "Penggantian pelumas mesin dan filter oli",
      price: 50000,
      estimatedMinutes: 30,
      vehicleType: "CAR",
      reminderIntervalDays: 180,
      reminderIntervalKm: 5000,
    },
    {
      categoryId: categories[0].id,
      name: "Jasa Ganti Oli Mesin Motor",
      description: "Penggantian pelumas mesin dan oli gardan motor",
      price: 25000,
      estimatedMinutes: 20,
      vehicleType: "MOTORCYCLE",
      reminderIntervalDays: 60,
      reminderIntervalKm: 2500,
    },

    // Kategori 1: Mesin & Transmisi
    {
      categoryId: categories[1].id,
      name: "Carbon Cleaner Ruang Bakar Mobil",
      description: "Dekarbonisasi kerak piston dan klep mesin",
      price: 350000,
      estimatedMinutes: 60,
      vehicleType: "CAR",
      reminderIntervalDays: 365,
      reminderIntervalKm: 20000,
    },
    {
      categoryId: categories[1].id,
      name: "Servis CVT Lengkap Motor Matic",
      description: "Pembersihan pulley, roller, v-belt, dan pemberian grease",
      price: 75000,
      estimatedMinutes: 45,
      vehicleType: "MOTORCYCLE",
      reminderIntervalDays: 120,
      reminderIntervalKm: 6000,
    },
    {
      categoryId: categories[1].id,
      name: "Flushing Kuras Radiator Coolant",
      description: "Kuras dan pengisian air pendingin mesin radiator",
      price: 90000,
      estimatedMinutes: 35,
      vehicleType: null,
      reminderIntervalDays: 365,
      reminderIntervalKm: 20000,
    },

    // Kategori 2: Rem & Kaki-kaki
    {
      categoryId: categories[2].id,
      name: "Brake Service & Bleeding Mobil",
      description: "Pembersihan 4 kaliper rem dan kuras minyak rem dot 4",
      price: 200000,
      estimatedMinutes: 60,
      vehicleType: "CAR",
      reminderIntervalDays: 365,
      reminderIntervalKm: 20000,
    },
    {
      categoryId: categories[2].id,
      name: "Ganti Kampas Rem Motor",
      description: "Pemasangan kampas rem depan atau belakang",
      price: 35000,
      estimatedMinutes: 30,
      vehicleType: "MOTORCYCLE",
      reminderIntervalDays: null,
      reminderIntervalKm: null,
    },
    {
      categoryId: categories[2].id,
      name: "Pengecekan Kaki-kaki & Suspensi",
      description: "Inspeksi tie rod, rack end, ball joint, dan shockbreaker",
      price: 120000,
      estimatedMinutes: 45,
      vehicleType: "CAR",
      reminderIntervalDays: 180,
      reminderIntervalKm: 10000,
    },

    // Kategori 3: Kelistrikan & AC
    {
      categoryId: categories[3].id,
      name: "Servis AC Ringan Mobil",
      description: "Cek tekanan freon, pembersihan filter kabin, dan evaporator",
      price: 180000,
      estimatedMinutes: 45,
      vehicleType: "CAR",
      reminderIntervalDays: 180,
      reminderIntervalKm: 10000,
    },
    {
      categoryId: categories[3].id,
      name: "Uji Beban Aki & Sistem Pengisian",
      description: "Pemeriksaan alternator, regulator kiprok, dan kesehatan aki",
      price: 40000,
      estimatedMinutes: 20,
      vehicleType: null,
      reminderIntervalDays: 90,
      reminderIntervalKm: null,
    },
    {
      categoryId: categories[3].id,
      name: "Scanning Diagnostik OBD-II Mobil",
      description: "Scan komputer ECU untuk membaca kode error sensor mesin",
      price: 150000,
      estimatedMinutes: 30,
      vehicleType: "CAR",
      reminderIntervalDays: null,
      reminderIntervalKm: null,
    },

    // Kategori 4: Ban & Spooring
    {
      categoryId: categories[4].id,
      name: "Spooring 3D Komputer Mobil",
      description: "Penyelarasan sudut camber, caster, dan toe roda",
      price: 180000,
      estimatedMinutes: 45,
      vehicleType: "CAR",
      reminderIntervalDays: 180,
      reminderIntervalKm: 10000,
    },
    {
      categoryId: categories[4].id,
      name: "Balancing Roda Mobil",
      description: "Penyeimbangan beban rotasi pelek dan ban per roda",
      price: 45000,
      estimatedMinutes: 20,
      vehicleType: "CAR",
      reminderIntervalDays: null,
      reminderIntervalKm: null,
    },
    {
      categoryId: categories[4].id,
      name: "Isi Gas Nitrogen Ban",
      description: "Kuras dan pengisian nitrogen murni 4 roda",
      price: 40000,
      estimatedMinutes: 15,
      vehicleType: null,
      reminderIntervalDays: null,
      reminderIntervalKm: null,
    },

    // Kategori 5: Detailing & Cuci
    {
      categoryId: categories[5].id,
      name: "Cuci Hidrolik Salju Mobil",
      description: "Cuci bodi, kolong hidrolik, semir ban, dan vacuum interior",
      price: 65000,
      estimatedMinutes: 45,
      vehicleType: "CAR",
      reminderIntervalDays: null,
      reminderIntervalKm: null,
    },
    {
      categoryId: categories[5].id,
      name: "Cuci Motor Premium",
      description: "Cuci bodi motor, pembersihan rantai/CVT, dan semir ban",
      price: 25000,
      estimatedMinutes: 30,
      vehicleType: "MOTORCYCLE",
      reminderIntervalDays: null,
      reminderIntervalKm: null,
    },
  ];

  const services = [];
  for (const s of servicesData) {
    let record = await withDeleted.service.findFirst({ where: { name: s.name } });
    if (!record) {
      record = await prisma.service.create({ data: s });
    }
    services.push(record);
  }

  // G. 25 Spareparts (Beberapa stok menipis <= 5 untuk alert dashboard)
  const sparepartsData = [
    {
      sku: "OLI-SHL-5W30",
      name: "Oli Shell Helix Ultra 5W-30 (1L)",
      price: 175000,
      stock: 24,
      unit: "botol",
    },
    {
      sku: "OLI-MOT-10W40",
      name: "Oli Motul 7100 4T 10W-40 (1L)",
      price: 160000,
      stock: 18,
      unit: "botol",
    },
    {
      sku: "OLI-TMO-0W20",
      name: "Oli TMO Full Synthetic 0W-20 (4L)",
      price: 480000,
      stock: 8,
      unit: "galon",
    },
    {
      sku: "OLI-AHM-MPX2",
      name: "Oli AHM MPX-2 Matic 0.8L",
      price: 58000,
      stock: 35,
      unit: "botol",
    },
    {
      sku: "OLI-GRD-012L",
      name: "Oli Gardan Motor Matic 120ml",
      price: 20000,
      stock: 40,
      unit: "botol",
    },
    {
      sku: "FLT-OLI-AVZ",
      name: "Filter Oli Toyota Avanza / Xenia",
      price: 45000,
      stock: 3,
      unit: "pcs",
    }, // STOK MENIPIS (3)
    {
      sku: "FLT-OLI-BRV",
      name: "Filter Oli Honda Brio / Jazz",
      price: 55000,
      stock: 2,
      unit: "pcs",
    }, // STOK MENIPIS (2)
    {
      sku: "FLT-UDA-AVZ",
      name: "Filter Udara Avanza Dual VVT-i",
      price: 95000,
      stock: 12,
      unit: "pcs",
    },
    { sku: "FLT-KAB-EXP", name: "Filter Kabin AC Expander", price: 85000, stock: 4, unit: "pcs" }, // STOK MENIPIS (4)
    {
      sku: "BUS-NGK-CR7E",
      name: "Busi NGK CR7E Standard Motor",
      price: 25000,
      stock: 30,
      unit: "pcs",
    },
    {
      sku: "BUS-DEN-IRID",
      name: "Busi Denso Iridium Power Mobil",
      price: 110000,
      stock: 16,
      unit: "pcs",
    },
    { sku: "KMP-REM-AVZF", name: "Kampas Rem Depan Avanza", price: 210000, stock: 5, unit: "set" }, // STOK MENIPIS (5)
    {
      sku: "KMP-REM-VARF",
      name: "Kampas Rem Depan Vario 150",
      price: 65000,
      stock: 22,
      unit: "set",
    },
    {
      sku: "RAD-CLT-PREM",
      name: "Prestone Radiator Coolant 4L",
      price: 120000,
      stock: 15,
      unit: "galon",
    },
    {
      sku: "BRK-FLD-DOT4",
      name: "Minyak Rem DOT 4 Jumbo 300ml",
      price: 38000,
      stock: 25,
      unit: "botol",
    },
    {
      sku: "AKI-GS-MF-34",
      name: "Aki GS Astra Maintenance Free 34B19R",
      price: 850000,
      stock: 6,
      unit: "unit",
    },
    { sku: "AKI-YUS-GTZ5", name: "Aki Yuasa GTZ-5S Motor", price: 240000, stock: 14, unit: "unit" },
    {
      sku: "WIP-BOS-20IN",
      name: "Wiper Bosch Advantage 20 Inchi",
      price: 65000,
      stock: 10,
      unit: "pcs",
    },
    {
      sku: "WIP-BOS-16IN",
      name: "Wiper Bosch Advantage 16 Inchi",
      price: 55000,
      stock: 10,
      unit: "pcs",
    },
    {
      sku: "BEL-GTS-VAR1",
      name: "V-Belt Gates Honda Vario 125/150",
      price: 135000,
      stock: 12,
      unit: "pcs",
    },
    {
      sku: "ROL-BRT-VAR1",
      name: "Roller BRT Racing Vario 11 Gram",
      price: 95000,
      stock: 8,
      unit: "set",
    },
    {
      sku: "MIN-STP-PWR",
      name: "Minyak Power Steering STP 354ml",
      price: 48000,
      stock: 15,
      unit: "botol",
    },
    {
      sku: "CLN-THB-WUR",
      name: "Wurth Throttle Body Cleaner 500ml",
      price: 85000,
      stock: 18,
      unit: "kaleng",
    },
    {
      sku: "BAN-MIC-185",
      name: "Ban Michelin Energy XM2+ 185/65 R15",
      price: 950000,
      stock: 8,
      unit: "pcs",
    },
    {
      sku: "BAN-IRC-9090",
      name: "Ban Tubeless IRC Exato 90/90-14",
      price: 235000,
      stock: 14,
      unit: "pcs",
    },
  ];

  const spareparts = [];
  for (const sp of sparepartsData) {
    let record = await withDeleted.sparepart.findUnique({ where: { sku: sp.sku } });
    if (!record) {
      record = await prisma.sparepart.create({ data: sp });
    }
    spareparts.push(record);
  }

  // H. Kendaraan Customer (Mobil & Motor)
  const vehiclesData = [
    {
      userId: customers[0].id,
      plateNumber: "B1234FAD",
      brand: "Toyota",
      model: "Avanza Veloz",
      type: "CAR",
      year: 2021,
      color: "Hitam Metalik",
      lastOdometerKm: 34500,
    },
    {
      userId: customers[1].id,
      plateNumber: "B5678BDS",
      brand: "Honda",
      model: "HR-V 1.5",
      type: "CAR",
      year: 2022,
      color: "Putih Mutiara",
      lastOdometerKm: 21000,
    },
    {
      userId: customers[2].id,
      plateNumber: "B9988CTL",
      brand: "Honda",
      model: "Vario 160",
      type: "MOTORCYCLE",
      year: 2023,
      color: "Merah Doff",
      lastOdometerKm: 8500,
    },
    {
      userId: customers[3].id,
      plateNumber: "B4321DWA",
      brand: "Mitsubishi",
      model: "Xpander Ultimate",
      type: "CAR",
      year: 2020,
      color: "Abu-abu",
      lastOdometerKm: 48000,
    },
    {
      userId: customers[4].id,
      plateNumber: "B7711EKO",
      brand: "Yamaha",
      model: "NMAX 155",
      type: "MOTORCYCLE",
      year: 2022,
      color: "Biru",
      lastOdometerKm: 14200,
    },
    {
      userId: customers[5].id,
      plateNumber: "B3399FJR",
      brand: "Suzuki",
      model: "Ertiga GL",
      type: "CAR",
      year: 2019,
      color: "Silver",
      lastOdometerKm: 62000,
    },
  ];

  const vehicles = [];
  for (const v of vehiclesData) {
    let record = await withDeleted.vehicle.findFirst({ where: { plateNumber: v.plateNumber } });
    if (!record) {
      record = await prisma.vehicle.create({
        data: {
          ...v,
          activePlate: v.plateNumber,
        },
      });
    }
    vehicles.push(record);
  }

  // I. Bookings dalam Berbagai Status Skenario
  const now = DateTime.now().setZone(RULES.TIMEZONE);
  const todayStr = now.toFormat("yyyyLLdd");
  const todayDate = now.toISODate();

  // Helper untuk membuat atau mengecek booking
  const ensureBooking = async ({
    code,
    customerId,
    outletId,
    vehicleId,
    mechanicId,
    scheduledAt,
    status,
    queueDate,
    queueNumber,
    isLate = false,
    checkedInAt,
    startedAt,
    readyAt,
    completedAt,
    cancelledAt,
    cancelledById,
    cancelReason,
    odometerKm,
    total,
    paymentStatus = "UNPAID",
    invoiceNumber,
    items = [],
  }) => {
    let booking = await prisma.booking.findUnique({ where: { code } });
    if (booking) return booking;

    const slotMinutes = outletId === outletBarat.id ? 60 : 45;
    const slotEndAt = new Date(new Date(scheduledAt).getTime() + slotMinutes * 60000);

    booking = await prisma.booking.create({
      data: {
        code,
        customerId,
        outletId,
        vehicleId,
        mechanicId,
        scheduledAt,
        slotEndAt,
        status,
        queueDate,
        queueNumber,
        isLate,
        checkedInAt,
        startedAt,
        readyAt,
        completedAt,
        cancelledAt,
        cancelledById,
        cancelReason,
        odometerKm,
        total,
        paymentStatus,
        invoiceNumber,
        logs: {
          create: {
            actorId: customerId,
            actorRole: "CUSTOMER",
            toStatus: status,
            note: `Initial seed booking status: ${status}`,
          },
        },
      },
    });

    for (const item of items) {
      await prisma.bookingItem.create({
        data: {
          bookingId: booking.id,
          type: item.type,
          serviceId: item.serviceId || null,
          sparepartId: item.sparepartId || null,
          nameSnapshot: item.nameSnapshot,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          subtotal: item.unitPrice * item.quantity,
          source: item.source || "CUSTOMER_BOOKING",
          approvalStatus: item.approvalStatus || "APPROVED",
          requestedById: item.requestedById || customerId,
          decidedById: item.decidedById || null,
          decidedAt: item.decidedAt || null,
          stockDeducted: item.stockDeducted || false,
          note: item.note || null,
        },
      });
    }

    return booking;
  };

  // 1. Status PENDING (Customer 0, Cabang Barat, Hari Ini, belum check-in)
  const bookingPending = await ensureBooking({
    code: `TLR-${todayStr}-PND001`,
    customerId: customers[0].id,
    outletId: outletBarat.id,
    vehicleId: vehicles[0].id,
    scheduledAt: now.plus({ hours: 2 }).toJSDate(),
    status: "PENDING",
    total: 250000,
    items: [
      {
        type: "SERVICE",
        serviceId: services[0].id,
        nameSnapshot: services[0].name,
        unitPrice: services[0].price,
        quantity: 1,
      },
    ],
  });

  // 2. Status CHECKED_IN (Customer 1, Cabang Barat, Antrian Berjalan #1)
  await ensureBooking({
    code: `TLR-${todayStr}-CHK001`,
    customerId: customers[1].id,
    outletId: outletBarat.id,
    vehicleId: vehicles[1].id,
    scheduledAt: now.minus({ hours: 1 }).toJSDate(),
    status: "CHECKED_IN",
    queueDate: new Date(todayDate),
    queueNumber: 1,
    checkedInAt: now.minus({ minutes: 50 }).toJSDate(),
    odometerKm: 21100,
    total: 350000,
    items: [
      {
        type: "SERVICE",
        serviceId: services[4].id,
        nameSnapshot: services[4].name,
        unitPrice: services[4].price,
        quantity: 1,
      },
    ],
  });

  // 3. Status IN_PROGRESS (Customer 2, Cabang Barat, Ditangani Mekanik 0)
  await ensureBooking({
    code: `TLR-${todayStr}-PRG001`,
    customerId: customers[2].id,
    outletId: outletBarat.id,
    vehicleId: vehicles[2].id,
    mechanicId: mechanics[0].id,
    scheduledAt: now.minus({ hours: 2 }).toJSDate(),
    status: "IN_PROGRESS",
    queueDate: new Date(todayDate),
    queueNumber: 2,
    checkedInAt: now.minus({ hours: 1, minutes: 45 }).toJSDate(),
    startedAt: now.minus({ hours: 1 }).toJSDate(),
    odometerKm: 8550,
    total: 160000,
    items: [
      {
        type: "SERVICE",
        serviceId: services[1].id,
        nameSnapshot: services[1].name,
        unitPrice: services[1].price,
        quantity: 1,
      },
      {
        type: "SERVICE",
        serviceId: services[5].id,
        nameSnapshot: services[5].name,
        unitPrice: services[5].price,
        quantity: 1,
      },
    ],
  });

  // 4. Status WAITING_APPROVAL (Customer 3, Cabang Barat, Item Tambahan Pending dari Mekanik 1)
  await ensureBooking({
    code: `TLR-${todayStr}-WAP001`,
    customerId: customers[3].id,
    outletId: outletBarat.id,
    vehicleId: vehicles[3].id,
    mechanicId: mechanics[1].id,
    scheduledAt: now.minus({ hours: 3 }).toJSDate(),
    status: "WAITING_APPROVAL",
    queueDate: new Date(todayDate),
    queueNumber: 3,
    checkedInAt: now.minus({ hours: 2, minutes: 45 }).toJSDate(),
    startedAt: now.minus({ hours: 2 }).toJSDate(),
    odometerKm: 48200,
    total: 250000, // Total item approved saat ini
    items: [
      {
        type: "SERVICE",
        serviceId: services[0].id,
        nameSnapshot: services[0].name,
        unitPrice: services[0].price,
        quantity: 1,
        approvalStatus: "APPROVED",
      },
      {
        type: "SPAREPART",
        sparepartId: spareparts[8].id,
        nameSnapshot: spareparts[8].name,
        unitPrice: spareparts[8].price,
        quantity: 1,
        source: "MECHANIC_ADDED",
        approvalStatus: "PENDING_APPROVAL",
        requestedById: mechanics[1].id,
        note: "Filter kabin AC sudah sangat kotor berdebu tebal, disarankan ganti baru",
      },
    ],
  });

  // 5. Status READY_FOR_PICKUP (Customer 4, Cabang Timur, Servis Selesai, Belum Lunas)
  await ensureBooking({
    code: `TLR-${todayStr}-RDY001`,
    customerId: customers[4].id,
    outletId: outletTimur.id,
    vehicleId: vehicles[4].id,
    mechanicId: mechanics[2].id,
    scheduledAt: now.minus({ hours: 4 }).toJSDate(),
    status: "READY_FOR_PICKUP",
    queueDate: new Date(todayDate),
    queueNumber: 1,
    checkedInAt: now.minus({ hours: 3, minutes: 30 }).toJSDate(),
    startedAt: now.minus({ hours: 3 }).toJSDate(),
    readyAt: now.minus({ minutes: 30 }).toJSDate(),
    odometerKm: 14350,
    total: 100000,
    paymentStatus: "UNPAID",
    items: [
      {
        type: "SERVICE",
        serviceId: services[1].id,
        nameSnapshot: services[1].name,
        unitPrice: services[1].price,
        quantity: 1,
      },
      {
        type: "SERVICE",
        serviceId: services[3].id,
        nameSnapshot: services[3].name,
        unitPrice: services[3].price,
        quantity: 1,
      },
    ],
  });

  // 6. Status COMPLETED (Customer 0, Cabang Barat, Lunas Cash Kasir + Tip Tunai)
  const bookingCompletedCash = await ensureBooking({
    code: `TLR-20261110-CMP001`,
    customerId: customers[0].id,
    outletId: outletBarat.id,
    vehicleId: vehicles[0].id,
    mechanicId: mechanics[0].id,
    scheduledAt: now.minus({ days: 3, hours: 4 }).toJSDate(),
    status: "COMPLETED",
    queueDate: now.minus({ days: 3 }).toJSDate(),
    queueNumber: 1,
    checkedInAt: now.minus({ days: 3, hours: 3, minutes: 45 }).toJSDate(),
    startedAt: now.minus({ days: 3, hours: 3 }).toJSDate(),
    readyAt: now.minus({ days: 3, hours: 1 }).toJSDate(),
    completedAt: now.minus({ days: 3, minutes: 30 }).toJSDate(),
    odometerKm: 34600,
    total: 250000,
    paymentStatus: "PAID",
    invoiceNumber: "INV-20261110-0001",
    items: [
      {
        type: "SERVICE",
        serviceId: services[0].id,
        nameSnapshot: services[0].name,
        unitPrice: services[0].price,
        quantity: 1,
      },
    ],
  });

  // Pembayaran Invoice Cash
  let payCash = await prisma.payment.findUnique({
    where: { orderId: `INV-${bookingCompletedCash.code}` },
  });
  if (!payCash) {
    payCash = await prisma.payment.create({
      data: {
        bookingId: bookingCompletedCash.id,
        type: "INVOICE",
        method: "CASH",
        orderId: `INV-${bookingCompletedCash.code}`,
        amount: 250000,
        status: "PAID",
        paidAt: now.minus({ days: 3, minutes: 40 }).toJSDate(),
        receivedById: admin.id,
      },
    });
  }

  // 7. Status COMPLETED (Customer 1, Cabang Timur, Lunas Midtrans + Tip + Review Bintang 5)
  const bookingCompletedMidtrans = await ensureBooking({
    code: `TLR-20261112-CMP002`,
    customerId: customers[1].id,
    outletId: outletTimur.id,
    vehicleId: vehicles[1].id,
    mechanicId: mechanics[2].id,
    scheduledAt: now.minus({ days: 1, hours: 5 }).toJSDate(),
    status: "COMPLETED",
    queueDate: now.minus({ days: 1 }).toJSDate(),
    queueNumber: 1,
    checkedInAt: now.minus({ days: 1, hours: 4, minutes: 45 }).toJSDate(),
    startedAt: now.minus({ days: 1, hours: 4 }).toJSDate(),
    readyAt: now.minus({ days: 1, hours: 2 }).toJSDate(),
    completedAt: now.minus({ days: 1, hours: 1 }).toJSDate(),
    odometerKm: 21250,
    total: 350000,
    paymentStatus: "PAID",
    invoiceNumber: "INV-20261112-0002",
    items: [
      {
        type: "SERVICE",
        serviceId: services[4].id,
        nameSnapshot: services[4].name,
        unitPrice: services[4].price,
        quantity: 1,
      },
    ],
  });

  // Pembayaran Midtrans Snap Lunas
  let payMidtrans = await prisma.payment.findUnique({
    where: { orderId: `INV-${bookingCompletedMidtrans.code}` },
  });
  if (!payMidtrans) {
    payMidtrans = await prisma.payment.create({
      data: {
        bookingId: bookingCompletedMidtrans.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `INV-${bookingCompletedMidtrans.code}`,
        amount: 350000,
        status: "PAID",
        snapToken: "snap-token-demo-1234567890",
        redirectUrl: "https://app.sandbox.midtrans.com/snap/v2/vtweb/demo-123",
        midtransTransactionId: "midtrans-tx-001",
        midtransPaymentType: "qris",
        paidAt: now.minus({ days: 1, hours: 1, minutes: 15 }).toJSDate(),
      },
    });
  }

  // Pembayaran TIP untuk Mekanik Dodi
  let payTip = await prisma.payment.findUnique({
    where: { orderId: `TIP-${bookingCompletedMidtrans.code}-1` },
  });
  if (!payTip) {
    payTip = await prisma.payment.create({
      data: {
        bookingId: bookingCompletedMidtrans.id,
        type: "TIP",
        method: "MIDTRANS",
        orderId: `TIP-${bookingCompletedMidtrans.code}-1`,
        amount: 30000,
        status: "PAID",
        recipientMechanicId: mechanics[2].id,
        snapToken: "snap-token-tip-demo-9988",
        paidAt: now.minus({ days: 1, minutes: 50 }).toJSDate(),
      },
    });
  }

  // Ulasan Review Bintang 5 untuk Booking Selesai
  const existingReview = await prisma.review.findUnique({
    where: { bookingId: bookingCompletedMidtrans.id },
  });
  if (!existingReview) {
    await prisma.review.create({
      data: {
        bookingId: bookingCompletedMidtrans.id,
        customerId: customers[1].id,
        outletId: outletTimur.id,
        mechanicId: mechanics[2].id,
        rating: 5,
        comment:
          "Pelayanan sangat memuaskan, ruang mesin bersih kembali dan tarikan mobil lebih enteng!",
        isHidden: false,
      },
    });
  }

  // 8. Status NO_SHOW (Customer 5, Tidak Hadir & Melewati Batas Waktu)
  await ensureBooking({
    code: `TLR-20261108-NOS001`,
    customerId: customers[5].id,
    outletId: outletBarat.id,
    vehicleId: vehicles[5].id,
    scheduledAt: now.minus({ days: 5, hours: 6 }).toJSDate(),
    status: "NO_SHOW",
    isLate: true,
    total: 180000,
    items: [
      {
        type: "SERVICE",
        serviceId: services[10].id,
        nameSnapshot: services[10].name,
        unitPrice: services[10].price,
        quantity: 1,
      },
    ],
  });

  // 9. Status CANCELLED (Customer 4, Dibatalkan oleh Pelanggan)
  await ensureBooking({
    code: `TLR-20261109-CNC001`,
    customerId: customers[4].id,
    outletId: outletTimur.id,
    vehicleId: vehicles[4].id,
    scheduledAt: now.minus({ days: 4, hours: 3 }).toJSDate(),
    status: "CANCELLED",
    cancelledAt: now.minus({ days: 4, hours: 5 }).toJSDate(),
    cancelledById: customers[4].id,
    cancelReason: "Ada keperluan mendadak ke luar kota, akan jadwalkan ulang minggu depan.",
    total: 65000,
    items: [
      {
        type: "SERVICE",
        serviceId: services[16].id,
        nameSnapshot: services[16].name,
        unitPrice: services[16].price,
        quantity: 1,
      },
    ],
  });

  // J. ServiceReminder (Pengingat Servis Jatuh Tempo & Terjadwal)
  const existingDueReminder = await prisma.serviceReminder.findFirst({
    where: {
      vehicleId: vehicles[0].id,
      serviceId: services[0].id,
    },
  });
  if (!existingDueReminder) {
    await prisma.serviceReminder.create({
      data: {
        vehicleId: vehicles[0].id,
        serviceId: services[0].id,
        userId: customers[0].id,
        sourceBookingId: bookingCompletedCash.id,
        dueOdometerKm: 34500,
        dueDate: now.minus({ days: 5 }).toJSDate(), // Sudah jatuh tempo 5 hari lalu
        status: "DUE",
      },
    });
  }

  const existingSchedReminder = await prisma.serviceReminder.findFirst({
    where: {
      vehicleId: vehicles[1].id,
      serviceId: services[4].id,
    },
  });
  if (!existingSchedReminder) {
    await prisma.serviceReminder.create({
      data: {
        vehicleId: vehicles[1].id,
        serviceId: services[4].id,
        userId: customers[1].id,
        sourceBookingId: bookingCompletedMidtrans.id,
        dueOdometerKm: 40000,
        dueDate: now.plus({ days: 150 }).toJSDate(),
        status: "SCHEDULED",
      },
    });
  }

  // K. Buat Payload QR Valid untuk Booking PENDING (untuk demo scanner check-in)
  const qrDemo = createQrPayload(bookingPending.code);

  return {
    admin,
    outlets: [outletBarat, outletTimur],
    mechanics,
    customers,
    categories,
    services,
    spareparts,
    vehicles,
    qrDemo,
  };
}

/**
 * Main Runner & Print Kredensial Demo
 */
async function main() {
  try {
    console.log("\n=======================================================");
    console.log("       TALLERO AUTO — DATABASE SEEDING ENGINE");
    console.log("=======================================================\n");

    const result = await seedDemoData();

    console.log("✅ Seeding master data dan transaksi demo selesai dengan sukses!\n");
    console.log(
      "--------------------------------------------------------------------------------------------------"
    );
    console.log(
      "                                 DAFTAR AKUN DEMO RESMI                                           "
    );
    console.log(
      "--------------------------------------------------------------------------------------------------"
    );
    console.table([
      {
        Role: "ADMIN",
        Nama: result.admin.name,
        Email: result.admin.email,
        Password: env.SEED_ADMIN_PASSWORD,
        Keterangan: "Akses penuh Dashboard Admin, Kasir Cash, Master Data",
      },
      {
        Role: "MECHANIC",
        Nama: result.mechanics[0].name,
        Email: result.mechanics[0].email,
        Password: "MekanikTallero123!",
        Keterangan: "Mekanik Cabang Barat (Antrian, Start, Tambah Item, Foto)",
      },
      {
        Role: "MECHANIC",
        Nama: result.mechanics[2].name,
        Email: result.mechanics[2].email,
        Password: "MekanikTallero123!",
        Keterangan: "Mekanik Cabang Timur (Antrian, Start, Tambah Item, Foto)",
      },
      {
        Role: "CUSTOMER",
        Nama: result.customers[0].name,
        Email: result.customers[0].email,
        Password: "CustomerTallero123!",
        Keterangan: "Customer (Booking Pending, Kendaraan Avanza Veloz)",
      },
      {
        Role: "CUSTOMER",
        Nama: result.customers[1].name,
        Email: result.customers[1].email,
        Password: "CustomerTallero123!",
        Keterangan: "Customer (Booking Selesai, Invoice, Review, HR-V)",
      },
      {
        Role: "CUSTOMER",
        Nama: result.customers[3].name,
        Email: result.customers[3].email,
        Password: "CustomerTallero123!",
        Keterangan: "Customer (Menunggu Approval Item Tambahan, Xpander)",
      },
    ]);

    console.log(
      "\n--------------------------------------------------------------------------------------------------"
    );
    console.log(
      "                                CONTOH QR CODE CHECK-IN DEMO                                      "
    );
    console.log(
      "--------------------------------------------------------------------------------------------------"
    );
    console.log("Payload QR Scan untuk Check-in Booking PENDING:");
    console.log(result.qrDemo);
    console.log(
      "--------------------------------------------------------------------------------------------------\n"
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, "Gagal menjalankan seed database");
    console.error("Gagal menjalankan seed:", err.message);
    process.exit(1);
  });
}

export default {
  seedInitialAdmin,
  seedDemoData,
};
