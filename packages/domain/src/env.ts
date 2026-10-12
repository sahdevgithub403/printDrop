import { assertServerRuntime } from "./serverOnly.js";

// Fail-fast server environment validation.
// Mirrors backend/.../config/RequiredEnvValidator.java: non-dev/test
// profiles abort startup when APP_JWT_SECRET is blank or < 32 chars and
// when the datasource password is blank. Razorpay keys stay warning-only
// there and are out of scope for this auth/DB foundation phase.
export interface ServerEnv {
  /** Trimmed HS256 secret (>= 32 chars). Never sent to the browser. */
  jwtSecret: string;
  /** Prisma connection string. Never sent to the browser. */
  databaseUrl: string;
}

const MIN_JWT_SECRET_LENGTH = 32;

export function loadServerEnv(
  env: NodeJS.ProcessEnv = process.env
): ServerEnv {
  assertServerRuntime("loadServerEnv");

  const missing: string[] = [];

  const rawJwtSecret = env["JWT_SECRET"] ?? "";
  const jwtSecret = rawJwtSecret.trim();
  if (jwtSecret.length === 0) {
    missing.push("JWT_SECRET");
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      "loadServerEnv: JWT_SECRET must be at least 32 characters for HS256 signing"
    );
  }

  const rawDatabaseUrl = env["DATABASE_URL"] ?? "";
  const databaseUrl = rawDatabaseUrl.trim();
  if (databaseUrl.length === 0) {
    missing.push("DATABASE_URL");
  }

  if (missing.length > 0) {
    throw new Error(
      `loadServerEnv: missing required server secrets: ${missing.join(" ")}. ` +
        "Set them via environment variables (see packages/db/.env.example)."
    );
  }

  return { jwtSecret, databaseUrl };
}
