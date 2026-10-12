import bcrypt from "bcryptjs";
import { assertServerRuntime } from "../serverOnly.js";

// BCrypt password handling compatible with Spring's BCryptPasswordEncoder.
// Source: backend/.../security/SecurityConfig.java uses
// `new BCryptPasswordEncoder()` (default strength 10); AuthService stores
// `passwordEncoder.encode(...)` and verifies via AuthenticationManager.
// bcryptjs `compare` verifies $2a$ Spring hashes (same Blowfish crypt).

/** Spring's BCryptPasswordEncoder default log-rounds. */
export const BCRYPT_COST = 10;

export async function hashPassword(plainPassword: string): Promise<string> {
  assertServerRuntime("hashPassword");
  return bcrypt.hash(plainPassword, BCRYPT_COST);
}

/** Returns true when the plain password matches the stored BCrypt hash. */
export async function verifyPassword(
  plainPassword: string,
  storedHash: string
): Promise<boolean> {
  assertServerRuntime("verifyPassword");
  if (!plainPassword || !storedHash) {
    return false;
  }
  try {
    return await bcrypt.compare(plainPassword, storedHash);
  } catch {
    // Malformed stored hash: treat as non-match (Spring would throw
    // BadCredentials upstream, mapping to 401 — never authenticate).
    return false;
  }
}
