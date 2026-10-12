import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests touch PostgreSQL and parse PDFs; allow headroom
    // under parallel load instead of flaking on the 5s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
