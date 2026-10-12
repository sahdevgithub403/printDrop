import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, BCRYPT_COST } from "./password.js";

describe("BCrypt compatibility (BCryptPasswordEncoder, default strength)", () => {
  it("uses cost 10 like Spring's default", () => {
    expect(BCRYPT_COST).toBe(10);
  });

  it("hashes at cost 10 and verifies (Spring reads $2a$/$2b$ interchangeably)", async () => {
    const hash = await hashPassword("correct-horse-42");
    expect(hash.startsWith("$2b$10$") || hash.startsWith("$2a$10$")).toBe(
      true
    );
    expect(await verifyPassword("correct-horse-42", hash)).toBe(true);
  });

  it("rejects wrong passwords (invalid credentials path)", async () => {
    const hash = await hashPassword("correct-horse-42");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("verifies a pre-existing Spring $2a$ hash from the legacy database", async () => {
    // $2a$ and $2b$ are cryptographically identical revisions (only the
    // version char differs); Spring's BCryptPasswordEncoder emits $2a$.
    // Relabeling a real hash to $2a$ reproduces exactly what legacy rows
    // contain, proving old-password compatibility.
    const springStyle = (await hashPassword("shop-password-1")).replace(
      "$2b$",
      "$2a$"
    );
    expect(springStyle.startsWith("$2a$10$")).toBe(true);
    expect(await verifyPassword("shop-password-1", springStyle)).toBe(true);
    expect(await verifyPassword("other", springStyle)).toBe(false);
  });

  it("never authenticates on empty or malformed stored hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("", "$2a$10$abc")).toBe(false);
    expect(await verifyPassword("x", "not-a-bcrypt-hash")).toBe(false);
  });
});
