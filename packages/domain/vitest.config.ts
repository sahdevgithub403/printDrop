import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // PDF parsing + OLE cases are slow on cold start; headroom instead
    // of flakes on the 5s default under parallel load.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
