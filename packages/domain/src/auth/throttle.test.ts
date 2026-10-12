import { describe, expect, it } from "vitest";
import {
  AttemptThrottle,
  TooManyAttemptsError,
  MAX_ATTEMPTS_PER_MINUTE,
} from "./throttle.js";

describe("login throttle (AuthService: 5/minute)", () => {
  it("caps at 5 attempts per key", () => {
    expect(MAX_ATTEMPTS_PER_MINUTE).toBe(5);
  });

  it("allows 5 then rejects the 6th with 429", () => {
    let now = 1_000_000;
    const throttle = new AttemptThrottle(() => now);
    for (let i = 0; i < 5; i++) {
      expect(() => throttle.check("Owner@Example.com ")).not.toThrow();
    }
    try {
      throttle.check("owner@example.com");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TooManyAttemptsError);
      expect((err as TooManyAttemptsError).status).toBe(429);
    }
  });

  it("normalizes keys (trim + lowercase share a bucket)", () => {
    let now = 2_000_000;
    const throttle = new AttemptThrottle(() => now);
    for (let i = 0; i < 2; i++) {
      throttle.check("  USER@x.com");
      throttle.check("user@X.com ");
    }
    // 4 in the shared bucket: the 5th (any casing/spacing) passes...
    expect(() => throttle.check("uSeR@x.com")).not.toThrow();
    // ...and the 6th is rejected.
    expect(() => throttle.check("USER@x.com")).toThrow(TooManyAttemptsError);
    // A different key is unaffected.
    expect(() => throttle.check("other@x.com")).not.toThrow();
  });

  it("resets after the 60s window and ignores null keys", () => {
    let now = 3_000_000;
    const throttle = new AttemptThrottle(() => now);
    for (let i = 0; i < 5; i++) {
      throttle.check("k@x.com");
    }
    expect(() => throttle.check("k@x.com")).toThrow(TooManyAttemptsError);
    now += 60_001;
    expect(() => throttle.check("k@x.com")).not.toThrow();
    expect(() => throttle.check(null)).not.toThrow();
    expect(() => throttle.check(undefined)).not.toThrow();
  });
});
