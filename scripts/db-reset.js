import readline from "node:readline/promises";
import { execSync } from "node:child_process";
import env from "../src/config/env.js";

async function main() {
  console.log("\n========================================================");
  console.log("⚠️  PENGAMAN RESET DATABASE TALLERO AUTO");
  console.log("========================================================\n");

  // 1. Larang keras berjalan di environment production
  if (env.NODE_ENV === "production") {
    console.error(
      "❌ ERROR FATAL: db:reset dilarang keras dijalankan pada environment PRODUCTION!"
    );
    process.exit(1);
  }

  // 2. Periksa apakah DATABASE_URL terindikasi server production/cloud
  const dbUrl = env.DATABASE_URL.toLowerCase();
  const prohibitedKeywords = ["prod", "production", "aws", "rds", "supabase", "railway", "neon"];
  const isCloudOrProd = prohibitedKeywords.some((keyword) => dbUrl.includes(keyword));

  if (isCloudOrProd) {
    console.error("❌ ERROR: DATABASE_URL terindikasi sebagai database production atau cloud!");
    console.error(`URL saat ini: ${env.DATABASE_URL}`);
    console.error("Operasi dibatalkan demi keamanan data.");
    process.exit(1);
  }

  // 3. Konfirmasi interaktif kepada developer
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(`Database target : ${env.DATABASE_URL}`);
    console.log("Tindakan ini akan MENGHAPUS SEMUA TABEL DAN DATA pada database di atas!\n");

    const answer = await rl.question(
      "Ketik 'RESET' (huruf besar) untuk mengonfirmasi reset database development: "
    );

    if (answer.trim() !== "RESET") {
      console.log("\n🛑 Konfirmasi tidak sesuai. Reset database DIBATALKAN.");
      process.exit(0);
    }

    console.log("\n⏳ Menjalankan prisma migrate reset --force...");
    execSync("npx prisma migrate reset --force --skip-seed", {
      stdio: "inherit",
      env: process.env,
    });

    console.log("\n✅ Database development berhasil di-reset dengan aman.\n");
  } catch (error) {
    console.error("\n❌ Gagal melakukan reset database:", error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
