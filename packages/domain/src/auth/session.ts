import { assertServerRuntime } from "../serverOnly.js";

// Database-backed session validation.
// Source: backend/.../security/JwtAuthenticationFilter.java — when the
// verified JWT carries a sessionId, the request is rejected 401
// ("Session is invalid or expired") unless a session row exists AND
// status == ACTIVE AND expiresAt is NOT before now
// (i.e. expiresAt >= now is still usable). The row id is then exposed as
// the USER_SESSION_ID request attribute (heartbeat/audit consumers).
// AuthService.createSession: UUID sessionToken, deviceId default
// "UNKNOWN", expiresAt = now + 1 day (matches the 24h JWT), ACTIVE;
// login revokes ALL of the user's sessions first ("NEW_LOGIN").

/** Minimal structural view of a user_sessions row (no Prisma import). */
export interface SessionRow {
  id: string;
  sessionToken: string;
  status: string;
  expiresAt: Date;
}

/** Minimal repository surface (tests inject fakes; no DB touched). */
export interface SessionStore {
  findBySessionToken(
    sessionToken: string
  ): Promise<Pick<SessionRow, "id" | "status" | "expiresAt"> | null>;
}

export const ACTIVE = "ACTIVE";

/** Pure check mirroring the filter's row test (boundary: expiresAt == now is usable). */
export function isSessionUsable(
  session: Pick<SessionRow, "status" | "expiresAt"> | null | undefined,
  now: Date = new Date()
): boolean {
  if (session == null) {
    return false;
  }
  if (session.status !== ACTIVE) {
    return false;
  }
  return session.expiresAt.getTime() >= now.getTime();
}

export class SessionInvalidError extends Error {
  readonly code = "SESSION_INVALID";
}

/**
 * Resolves a sessionId claim to its usable row id (the USER_SESSION_ID
 * equivalent). Throws SessionInvalidError when missing/revoked/expired.
 * A null sessionId (pre-session token) resolves to null — the filter
 * skips the session check in that case.
 */
export async function resolveSessionId(
  store: SessionStore,
  sessionId: string | null,
  now: Date = new Date()
): Promise<string | null> {
  assertServerRuntime("resolveSessionId");
  if (sessionId == null) {
    return null;
  }
  const row = await store.findBySessionToken(sessionId);
  if (!isSessionUsable(row, now)) {
    throw new SessionInvalidError("Session is invalid or expired");
  }
  return row!.id;
}
