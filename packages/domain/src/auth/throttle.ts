import { assertServerRuntime } from "../serverOnly.js";

// In-memory sliding-window attempt throttle.
// Source: backend/.../service/AuthService.throttleLogin — shared by login,
// signup and password-reset paths: max 5 attempts per 60s window per key,
// key normalized (trim + lowercase); exceeding throws 429
// "Too many login attempts. Please try again in a minute."
// The clock is injectable so tests never sleep.

export const MAX_ATTEMPTS_PER_MINUTE = 5;
const WINDOW_MS = 60_000;

export class TooManyAttemptsError extends Error {
  readonly status = 429 as const;
  constructor() {
    super("Too many login attempts. Please try again in a minute.");
  }
}

export type NowProvider = () => number;

export class AttemptThrottle {
  private readonly attempts = new Map<string, number[]>();
  constructor(private readonly now: NowProvider = Date.now) {}

  private normalize(key: string): string {
    return key.trim().toLowerCase();
  }

  /** Records an attempt; throws TooManyAttemptsError past the limit. */
  check(key: string | null | undefined): void {
    assertServerRuntime("AttemptThrottle.check");
    if (key == null) {
      return;
    }
    const norm = this.normalize(key);
    const now = this.now();
    const window = this.attempts.get(norm) ?? [];
    const fresh = window.filter((t) => now - t <= WINDOW_MS);
    if (fresh.length >= MAX_ATTEMPTS_PER_MINUTE) {
      this.attempts.set(norm, fresh);
      throw new TooManyAttemptsError();
    }
    fresh.push(now);
    this.attempts.set(norm, fresh);
  }
}
