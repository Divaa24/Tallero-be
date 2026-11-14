import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkProjectStructure } from "../../scripts/check-structure.js";

describe("Unit: scripts/check-structure.js", () => {
  const tempDirs = [];

  const makeTempRepo = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tallero-struct-"));
    tempDirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    return dir;
  };

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it("lulus untuk struktur proyek aktif saat ini", () => {
    const result = checkProjectStructure(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("gagal bila ada folder terlarang (modules/, core/) atau subfolder lapisan", () => {
    const dir = makeTempRepo({
      "src/modules/auth/auth.controller.js": "",
      "src/controllers/auth/auth.controller.js": "",
    });

    const result = checkProjectStructure(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("src/modules/"))).toBe(true);
    expect(result.errors.some((e) => e.includes("src/controllers/auth/"))).toBe(true);
  });

  it("gagal bila file lapisan berada di luar foldernya atau memakai nama/barrel terlarang", () => {
    const dir = makeTempRepo({
      "src/utils/auth.service.js": "",
      "src/services/auth.mapper.js": "",
      "src/services/auth.policy.js": "",
      "src/utils/authHelper.js": "",
      "src/services/index.js": "",
    });

    const result = checkProjectStructure(dir);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(5);
  });

  it("gagal bila ada import dari _legacy/", () => {
    const legacyDirName = "_" + "legacy";
    const dir = makeTempRepo({
      "src/routes/index.js": `import oldApp from "../../${legacyDirName}/src/app.js";\nexport default oldApp;`,
    });

    const result = checkProjectStructure(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("_legacy/"))).toBe(true);
  });
});
