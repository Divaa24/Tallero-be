import { describe, it, expect } from "vitest";
import { ALL_ENDPOINTS } from "../../scripts/generate-openapi.js";
import { getMountedRoutes } from "../../scripts/verify-endpoints.js";

describe("Endpoint catalog matches mounted Express routes", () => {
  it("documents every method/path exactly once", () => {
    const mounted = getMountedRoutes()
      .map((r) => `${r.method.toUpperCase()} ${r.path.replace(/:([A-Za-z]+)/g, "{$1}")}`)
      .sort();
    const documented = ALL_ENDPOINTS.map(
      (r) => `${r.method.toUpperCase()} /api/v1${r.path}`
    ).sort();
    expect(new Set(mounted).size).toBe(mounted.length);
    expect(mounted).toEqual(documented);
  });
});
