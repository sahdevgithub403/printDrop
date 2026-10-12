import { afterEach, describe, expect, it } from "vitest";
import { loadServerEnv } from "../env.js";
import {
  unauthorizedBody,
  INVALID_TOKEN_MESSAGE,
  INVALID_SESSION_MESSAGE,
} from "./http.js";

const KEEP = { ...process.env };

afterEach(() => {
  process.env = { ...KEEP };
});

describe("server env validation (RequiredEnvValidator)", () => {
  it("accepts test-only secrets and trims them", () => {
    process.env["JWT_SECRET"] = "  test-only-secret-0123456789abcdef  ";
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    const env = loadServerEnv();
    expect(env.jwtSecret).toBe("test-only-secret-0123456789abcdef");
    expect(env.databaseUrl).toBe("postgresql://localhost/test");
  });

  it("fails fast on missing or short JWT secrets", () => {
    delete process.env["JWT_SECRET"];
    process.env["DATABASE_URL"] = "postgresql://localhost/test";
    expect(() => loadServerEnv()).toThrow(/JWT_SECRET/);
    process.env["JWT_SECRET"] = "too-short-secret";
    expect(() => loadServerEnv()).toThrow(/at least 32 characters/);
  });

  it("fails fast on missing DATABASE_URL", () => {
    process.env["JWT_SECRET"] = "test-only-secret-0123456789abcdef";
    delete process.env["DATABASE_URL"];
    expect(() => loadServerEnv()).toThrow(/DATABASE_URL/);
  });
});

describe("legacy 401 envelope (JwtAuthenticationFilter.unauthorized)", () => {
  it("emits {success:false,message,data:null} with legacy messages", () => {
    expect(unauthorizedBody(INVALID_TOKEN_MESSAGE)).toEqual({
      success: false,
      message: "Invalid or expired token",
      data: null,
    });
    expect(unauthorizedBody(INVALID_SESSION_MESSAGE)).toEqual({
      success: false,
      message: "Session is invalid or expired",
      data: null,
    });
  });
});
