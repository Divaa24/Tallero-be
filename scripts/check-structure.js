import fs from "node:fs";
import path from "node:path";

const LAYER_SUFFIX_MAP = Object.freeze({
  ".routes.js": "routes",
  ".controller.js": "controllers",
  ".service.js": "services",
  ".validation.js": "validations",
  ".job.js": "jobs",
});

const ALLOWED_LAYER_DIRS = new Set([
  "config",
  "routes",
  "controllers",
  "services",
  "validations",
  "middlewares",
  "utils",
  "jobs",
]);

const FORBIDDEN_DIRS = new Set(["modules", "core", "lib", "integrations", "realtime"]);

const FORBIDDEN_NAME_TOKENS = new Set([
  "helper",
  "helpers",
  "util",
  "utils",
  "common",
  "manager",
  "handler",
  "factory",
  "base",
  "mapper",
  "policy",
  "dto",
  "v2",
  "new",
  "final",
]);

const WHITELISTED_HANDLER_PATHS = new Set(["src/middlewares/errorHandler.js"]);

const LEGACY_IMPORT_REGEX =
  /(?:import\s+(?:[^'"]*from\s+)?['"]|import\s*\(\s*['"]|require\s*\(\s*['"])[^'"]*_legacy(?:\/|\\|['"])/;

const toPosix = (p) => p.split(path.sep).join("/");

const tokenizeFilename = (filename) => {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1.$2")
    .split(/[._-]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
};

const walkFiles = (dirPath, results = []) => {
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
};

/**
 * Memvalidasi kepatuhan struktur folder & penamaan file terhadap AGENTS.md §2
 * @param {string} rootDir
 * @returns {{ ok: boolean, errors: string[] }}
 */
export const checkProjectStructure = (rootDir = process.cwd()) => {
  const errors = [];
  const srcDir = path.join(rootDir, "src");

  if (!fs.existsSync(srcDir)) {
    errors.push("Direktori src/ tidak ditemukan");
    return { ok: false, errors };
  }

  // 1. Periksa folder langsung di bawah src/ dan larangan subfolder bertingkat di lapisan
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    if (FORBIDDEN_DIRS.has(entry.name)) {
      errors.push(`Folder terlarang ditemukan: src/${entry.name}/ (dilarang AGENTS.md §2)`);
      continue;
    }

    if (!ALLOWED_LAYER_DIRS.has(entry.name)) {
      errors.push(`Folder tidak dikenal di src/: src/${entry.name}/`);
      continue;
    }

    const layerPath = path.join(srcDir, entry.name);
    for (const sub of fs.readdirSync(layerPath, { withFileTypes: true })) {
      if (sub.isDirectory()) {
        errors.push(
          `Subfolder terlarang di dalam lapisan: src/${entry.name}/${sub.name}/ (harus 1 level datar)`
        );
      }
    }
  }

  // 2. Periksa seluruh file di src/
  const srcFiles = walkFiles(srcDir);
  for (const absFile of srcFiles) {
    const relPath = toPosix(path.relative(rootDir, absFile));
    const parts = relPath.split("/");
    const filename = parts[parts.length - 1];
    const topLayer = parts.length > 2 ? parts[1] : null;

    if (!filename.endsWith(".js")) {
      continue;
    }

    // Cek barrel index.js (satu-satunya yang diizinkan: src/routes/index.js)
    if (filename === "index.js" && relPath !== "src/routes/index.js") {
      errors.push(
        `Barrel index.js terlarang di ${relPath} (hanya src/routes/index.js yang diizinkan)`
      );
    }

    // Cek penempatan suffix lapisan (*.controller.js, *.service.js, dll.)
    for (const [suffix, expectedLayer] of Object.entries(LAYER_SUFFIX_MAP)) {
      if (filename.endsWith(suffix)) {
        if (topLayer !== expectedLayer || parts.length !== 3) {
          errors.push(`File ${relPath} harus berada langsung di dalam src/${expectedLayer}/`);
        }
      }
    }

    // Cek bahwa seluruh file di src/services/ wajib berakhiran .service.js (AGENTS.md §2)
    if (topLayer === "services" && !filename.endsWith(".service.js")) {
      errors.push(
        `File di src/services/ wajib berakhiran .service.js (AGENTS.md §2, ditemukan: ${relPath})`
      );
    }

    // Cek kata/suffix nama terlarang
    if (!WHITELISTED_HANDLER_PATHS.has(relPath)) {
      const tokens = tokenizeFilename(filename);
      const forbidden = tokens.find((t) => FORBIDDEN_NAME_TOKENS.has(t));
      if (forbidden) {
        errors.push(`Nama file mengandung kata/suffix terlarang ('${forbidden}'): ${relPath}`);
      }
    }
  }

  // 3. Cek import dari _legacy/ pada seluruh kode aktif (src, prisma, scripts, tests)
  const scanRoots = ["src", "prisma", "scripts", "tests"];
  for (const folder of scanRoots) {
    const absFolder = path.join(rootDir, folder);
    for (const absFile of walkFiles(absFolder)) {
      if (!/\.(js|mjs|cjs|ts)$/.test(absFile)) continue;
      const content = fs.readFileSync(absFile, "utf8");
      if (LEGACY_IMPORT_REGEX.test(content)) {
        const relPath = toPosix(path.relative(rootDir, absFile));
        errors.push(`Import terlarang dari _legacy/ terdeteksi pada ${relPath}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
};

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  const result = checkProjectStructure(process.cwd());
  if (!result.ok) {
    console.error("\n❌ Pelanggaran struktur AGENTS.md §2 ditemukan:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    console.error("");
    process.exit(1);
  }
  console.log("✅ Struktur folder dan penamaan file sesuai AGENTS.md §2.");
}
