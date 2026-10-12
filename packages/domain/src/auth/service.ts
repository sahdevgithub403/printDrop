import { randomBytes, createHash } from "node:crypto";
import { assertServerRuntime } from "../serverOnly.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createJwt } from "./jwt.js";
import { AttemptThrottle } from "./throttle.js";
import { ROLE_SHOP_ADMIN } from "./authorization.js";

// Auth service: login / signup / forgot-password / reset-password.
// Sources (exact behavior transcribed):
// - backend/.../service/AuthService.java (throttle order, messages,
//   revoke-all-on-login(NEW_LOGIN), UUID session token, deviceId default
//   "UNKNOWN", session expiry now+1day, SHA-256 stored reset tokens with
//   1h expiry + single use, session revocation on reset(PASSWORD_RESET),
//   generic-success for unknown forgot emails, 503 when mail is down).
// - backend/.../controller/AuthController.java (endpoint messages/status).
// - backend/.../dto/AuthRequest/SignupRequest/AuthResponse (validation
//   messages, response fields; login NEVER returns the agent apiKey).
// - backend/.../service/EmailService.java (subject/body with raw token,
//   mail disabled -> log-only + false -> caller 503).
//
// Approximations (documented, not silent): @Valid multi-violation message
// order is HashMap-undefined in Spring — single-violation messages match
// exactly; the email-format check uses a permissive pattern close to
// Jakarta @Email defaults (exotic addresses may differ).

export class AuthServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 429 | 503
  ) {
    super(message);
  }
}

export const BAD_CREDENTIALS_MESSAGE = "Invalid email or password credentials";
const MAIL_UNAVAILABLE_MESSAGE =
  "Password reset email could not be sent. Mail service is not configured.";
const MAIL_SEND_FAILED_MESSAGE = "Failed to send password reset email";

/** Minimal structural DB surface (tests inject fakes or Prisma delegates). */
export interface AuthUserRow {
  id: string;
  email: string;
  password: string;
  name: string | null;
  phone: string | null;
  role: string;
  shopId: string | null;
  shop: { id: string; name: string | null; slug: string } | null;
}

export interface AuthDb {
  findUserByEmail(email: string): Promise<AuthUserRow | null>;
  emailExists(email: string): Promise<boolean>;
  createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    phone: string;
  }): Promise<AuthUserRow>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  revokeActiveSessions(userId: string, reason: string, now: Date): Promise<void>;
  createSession(input: {
    userId: string;
    sessionToken: string;
    deviceId: string;
    deviceName: string | null;
    appVersion: string | null;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  createResetToken(input: {
    userId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  findResetTokenByHash(
    tokenHash: string
  ): Promise<{ userId: string; used: boolean; expiresAt: Date } | null>;
  markResetTokenUsed(tokenHash: string): Promise<void>;
}

/** Mail sender surface mirroring EmailService (boolean, throws on failure). */
export interface ResetMailer {
  sendPasswordResetEmail(to: string, rawToken: string): Promise<boolean>;
}

export interface AuthContext {
  db: AuthDb;
  mailer: ResetMailer;
  throttle: AttemptThrottle;
  jwtSecret: string;
  now?: () => Date;
}

export interface AuthResponseBody {
  token: string;
  email: string;
  role: string;
  shopId: string | null;
  shopName: string | null;
  shopSlug: string | null;
  shopSetupComplete: boolean;
  apiKey: null;
  name: string | null;
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

// Permissive approximation of Jakarta @Email defaults (requires local@domain).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

function newSessionToken(): string {
  const uuid = randomBytes(16);
  uuid[6] = (uuid[6] & 0x0f) | 0x40;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  const hex = uuid.toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function newResetToken(): string {
  return randomBytes(32).toString("base64url");
}

async function authenticateAndCreateSession(
  ctx: AuthContext,
  user: AuthUserRow,
  device: { deviceId: string | null; deviceName: string | null; appVersion: string | null },
  now: Date
): Promise<AuthResponseBody> {
  // 1. Revoke existing active sessions (NEW_LOGIN).
  await ctx.db.revokeActiveSessions(user.id, "NEW_LOGIN", now);
  // 2. Create new session (UUID token, UNKNOWN device default, +1 day).
  const sessionToken = newSessionToken();
  await ctx.db.createSession({
    userId: user.id,
    sessionToken,
    deviceId: device.deviceId ?? "UNKNOWN",
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
  });
  // 3. JWT with session id (claims mirror JwtTokenProvider exactly).
  const jwt = await createJwt(ctx.jwtSecret, {
    email: user.email,
    role: user.role,
    shopId: user.shopId,
    sessionId: sessionToken,
  });
  return {
    token: jwt,
    email: user.email,
    role: user.role,
    shopId: user.shopId,
    shopName: user.shop?.name ?? null,
    shopSlug: user.shop?.slug ?? null,
    shopSetupComplete: user.shop != null,
    apiKey: null,
    name: user.name,
  };
}

export interface DeviceInfo {
  deviceId: string | null;
  deviceName: string | null;
  appVersion: string | null;
}

export async function login(
  ctx: AuthContext,
  input: { email: string; password: string },
  device: DeviceInfo
): Promise<AuthResponseBody> {
  assertServerRuntime("login");
  if (isBlank(input.email)) {
    throw new AuthServiceError("Email is required", 400);
  }
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    throw new AuthServiceError("Invalid email format", 400);
  }
  if (isBlank(input.password)) {
    throw new AuthServiceError("Password is required", 400);
  }
  ctx.throttle.check(input.email);
  const now = ctx.now?.() ?? new Date();
  const user = await ctx.db.findUserByEmail(input.email.trim());
  // BadCredentials for unknown email AND wrong password alike (401, no
  // account-existence leak — GlobalExceptionHandler message preserved).
  if (user == null || !(await verifyPassword(input.password, user.password))) {
    throw new AuthServiceError(BAD_CREDENTIALS_MESSAGE, 401);
  }
  return authenticateAndCreateSession(ctx, user, device, now);
}

export async function signup(
  ctx: AuthContext,
  input: {
    name: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
  },
  device: DeviceInfo
): Promise<AuthResponseBody> {
  assertServerRuntime("signup");
  if (isBlank(input.name)) {
    throw new AuthServiceError("Name is required", 400);
  }
  if (isBlank(input.email)) {
    throw new AuthServiceError("Email is required", 400);
  }
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    throw new AuthServiceError("Invalid email format", 400);
  }
  if (isBlank(input.phone)) {
    throw new AuthServiceError("Phone number is required", 400);
  }
  if (isBlank(input.password)) {
    throw new AuthServiceError("Password is required", 400);
  }
  if (input.password.length < 8) {
    throw new AuthServiceError("Password must be at least 8 characters", 400);
  }
  if (isBlank(input.confirmPassword)) {
    throw new AuthServiceError("Confirm password is required", 400);
  }
  ctx.throttle.check(`signup:${input.email}`);
  if (await ctx.db.emailExists(input.email.trim())) {
    throw new AuthServiceError("Email already in use", 400);
  }
  if (input.password !== input.confirmPassword) {
    throw new AuthServiceError("Passwords do not match", 400);
  }
  if (input.password.length < 8) {
    throw new AuthServiceError("Password must be at least 8 characters", 400);
  }
  const now = ctx.now?.() ?? new Date();
  const user = await ctx.db.createUser({
    email: input.email.trim(),
    passwordHash: await hashPassword(input.password),
    name: input.name.trim(),
    phone: input.phone.trim(),
  });
  // Auto-login after signup (role ROLE_SHOP_ADMIN assigned by the caller).
  return authenticateAndCreateSession(ctx, user, device, now);
}

export async function forgotPassword(
  ctx: AuthContext,
  email: string
): Promise<void> {
  assertServerRuntime("forgotPassword");
  if (isBlank(email)) {
    throw new AuthServiceError("Email is required", 400);
  }
  ctx.throttle.check(`forgot:${email}`);
  const now = ctx.now?.() ?? new Date();
  const user = await ctx.db.findUserByEmail(email.trim());
  // Unknown emails silently succeed (never leak account existence).
  if (user == null) {
    return;
  }
  const rawToken = newResetToken();
  // Net effect mirrors the @Transactional rollback on mail failure: when
  // mail is unavailable, no token row persists and the caller gets 503.
  let sent: boolean;
  try {
    sent = await ctx.mailer.sendPasswordResetEmail(user.email, rawToken);
  } catch {
    throw new AuthServiceError(MAIL_SEND_FAILED_MESSAGE, 400);
  }
  if (!sent) {
    throw new AuthServiceError(MAIL_UNAVAILABLE_MESSAGE, 503);
  }
  await ctx.db.createResetToken({
    userId: user.id,
    tokenHash: sha256Hex(rawToken),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
}

export async function resetPassword(
  ctx: AuthContext,
  rawToken: string | null | undefined,
  newPassword: string | null | undefined
): Promise<void> {
  assertServerRuntime("resetPassword");
  // Controller-level guard message preserved verbatim.
  if (rawToken == null || newPassword == null || newPassword.length < 8) {
    throw new AuthServiceError(
      "Valid token and new password (min 8 chars) are required",
      400
    );
  }
  const now = ctx.now?.() ?? new Date();
  const row = await ctx.db.findResetTokenByHash(sha256Hex(rawToken));
  if (row == null) {
    throw new AuthServiceError("Invalid reset token", 400);
  }
  if (row.used || row.expiresAt.getTime() < now.getTime()) {
    throw new AuthServiceError("Token has expired or already been used", 400);
  }
  await ctx.db.updateUserPassword(row.userId, await hashPassword(newPassword));
  await ctx.db.markResetTokenUsed(sha256Hex(rawToken));
  await ctx.db.revokeActiveSessions(row.userId, "PASSWORD_RESET", now);
}
