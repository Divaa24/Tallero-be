import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/_legacy/**", "**/dist/**"],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
