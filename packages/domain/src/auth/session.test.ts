import { describe, expect, it } from "vitest";
import {
  isSessionUsable,
  resolveSessionId,
  SessionInvalidError,
  type SessionStore,
} from "./session.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const future = new Date(NOW.getTime() + 3_600_000);
const past = new Date(NOW.getTime() - 1_000);

function storeWith(
  row: { id: string; status: string; expiresAt: Date } | null
): SessionStore {
  return {
    findBySessionToken: async (token: string) =>
      token === "tok-1" && row
        ? { ...row, sessionToken: "tok-1" }
        : null,
  };
}

describe("session validation (JwtAuthenticationFilter row test)", () => {
  it("accepts ACTIVE + unexpired sessions", () => {
    expect(
      isSessionUsable({ status: "ACTIVE", expiresAt: future }, NOW)
    ).toBe(true);
  });

  it("accepts the exact-expiry boundary (expiresAt == now is usable)", () => {
    // Mirrors expiresAt.isBefore(now): only strictly-before is rejected.
    expect(isSessionUsable({ status: "ACTIVE", expiresAt: NOW }, NOW)).toBe(
      true
    );
  });

  it("rejects REVOKED and EXPIRED rows and past expiry", () => {
    expect(isSessionUsable({ status: "REVOKED", expiresAt: future }, NOW)).toBe(
      false
    );
    expect(isSessionUsable({ status: "EXPIRED", expiresAt: future }, NOW)).toBe(
      false
    );
    expect(isSessionUsable({ status: "ACTIVE", expiresAt: past }, NOW)).toBe(
      false
    );
    expect(isSessionUsable(null, NOW)).toBe(false);
  });

  it("resolves usable sessions to the row id (USER_SESSION_ID)", async () => {
    const id = await resolveSessionId(
      storeWith({ id: "row-1", status: "ACTIVE", expiresAt: future }),
      "tok-1",
      NOW
    );
    expect(id).toBe("row-1");
  });

  it("throws on missing/revoked/expired sessions; null claim resolves null", async () => {
    await expect(
      resolveSessionId(storeWith(null), "tok-1", NOW)
    ).rejects.toBeInstanceOf(SessionInvalidError);
    await expect(
      resolveSessionId(
        storeWith({ id: "r", status: "REVOKED", expiresAt: future }),
        "tok-1",
        NOW
      )
    ).rejects.toBeInstanceOf(SessionInvalidError);
    await expect(
      resolveSessionId(
        storeWith({ id: "r", status: "ACTIVE", expiresAt: past }),
        "tok-1",
        NOW
      )
    ).rejects.toBeInstanceOf(SessionInvalidError);
    await expect(
      resolveSessionId(storeWith(null), null, NOW)
    ).resolves.toBeNull();
  });
});
