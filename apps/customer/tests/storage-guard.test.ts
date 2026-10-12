import { afterEach, describe, expect, it } from "vitest";
import { getStorage, resetStorage } from "../lib/documentRoutes.js";

// Production fail-closed gate (Phase 2B.4 issue 2): without R2
// credentials, production refuses to serve files instead of silently
// storing customer documents on local disk. Local-directory fallback is
// development/test only. No R2 connection is attempted here.

const KEEP_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...KEEP_ENV };
  resetStorage();
});

describe("document storage backend selection", () => {
  it("uses the local directory outside production (no R2 configured)", () => {
    delete process.env["R2_ENDPOINT"];
    delete process.env["R2_BUCKET"];
    delete process.env["R2_ACCESS_KEY_ID"];
    delete process.env["R2_SECRET_ACCESS_KEY"];
    resetStorage();
    expect(getStorage().backend).toBe("local-directory");
  });

  it("fails closed in production without R2", () => {
    delete process.env["R2_ENDPOINT"];
    delete process.env["R2_BUCKET"];
    delete process.env["R2_ACCESS_KEY_ID"];
    delete process.env["R2_SECRET_ACCESS_KEY"];
    (process.env as Record<string, string | undefined>)["NODE_ENV"] =
      "production";
    resetStorage();
    expect(() => getStorage()).toThrowError(/R2 credentials are required/);
  });
});
