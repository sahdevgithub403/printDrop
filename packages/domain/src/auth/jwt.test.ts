import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  createJwt,
  verifyJwt,
  JwtExpiredError,
  JwtInvalidError,
  JWT_EXPIRY_MS,
} from "./jwt.js";

const SECRET = "test-only-jwt-secret-0123456789abcdef";
const OTHER_SECRET = "test-only-other-secret-0123456789abcdef";

describe("HS256 JWT compatibility (JwtTokenProvider)", () => {
  it("round-trips email/shopId/role/sessionId claims", async () => {
    const token = await createJwt(SECRET, {
      email: "owner@example.com",
      role: "ROLE_SHOP_ADMIN",
      shopId: "11111111-1111-1111-1111-111111111111",
      sessionId: "session-token-1",
    });
    const claims = await verifyJwt(SECRET, token);
    expect(claims.email).toBe("owner@example.com");
    expect(claims.role).toBe("ROLE_SHOP_ADMIN");
    expect(claims.shopId).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims.sessionId).toBe("session-token-1");
  });

  it("omits sessionId when null (generateToken without session)", async () => {
    const token = await createJwt(SECRET, {
      email: "owner@example.com",
      role: "ROLE_SHOP_ADMIN",
      shopId: null,
    });
    const claims = await verifyJwt(SECRET, token);
    expect(claims.sessionId).toBeNull();
    expect(claims.shopId).toBeNull();
  });

  it("expires ~24h after issue (app.jwt.expiration-ms=86400000)", async () => {
    const token = await createJwt(SECRET, {
      email: "a@b.c",
      role: "ROLE_SHOP_ADMIN",
      shopId: null,
    });
    const claims = await verifyJwt(SECRET, token);
    expect(claims.expiresAt.getTime() - claims.issuedAt.getTime()).toBe(
      JWT_EXPIRY_MS
    );
    expect(JWT_EXPIRY_MS).toBe(86_400_000);
  });

  it("rejects tampered tokens (fail-closed like validateToken=false)", async () => {
    const token = await createJwt(SECRET, {
      email: "a@b.c",
      role: "ROLE_SHOP_ADMIN",
      shopId: null,
    });
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await expect(verifyJwt(SECRET, tampered)).rejects.toBeInstanceOf(
      JwtInvalidError
    );
  });

  it("rejects tokens signed with another secret", async () => {
    const token = await createJwt(OTHER_SECRET, {
      email: "a@b.c",
      role: "ROLE_SHOP_ADMIN",
      shopId: null,
    });
    await expect(verifyJwt(SECRET, token)).rejects.toBeInstanceOf(
      JwtInvalidError
    );
  });

  it("reports expiry distinctly from invalidity", async () => {
    const expired = await new SignJWT({ shopId: null, role: "ROLE_SHOP_ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("a@b.c")
      .setIssuedAt(new Date(Date.now() - 2 * JWT_EXPIRY_MS))
      .setExpirationTime(new Date(Date.now() - JWT_EXPIRY_MS))
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyJwt(SECRET, expired)).rejects.toBeInstanceOf(
      JwtExpiredError
    );
  });
});
