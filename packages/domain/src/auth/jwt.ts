import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { assertServerRuntime } from "../serverOnly.js";

// HS256 JWT compatibility layer.
// Source: backend/.../security/JwtTokenProvider.java —
//   generateTokenWithSession: subject=email, claims {shopId (string|null),
//     role (ROLE_-prefixed name), sessionId (only when non-null)},
//     issuedAt=now, expiration=now+86400000ms, HS256.
//   validateToken: false on any JwtException (bad signature, expiry, ...).
// application.yml: app.jwt.expiration-ms=86400000 (24h).

export const JWT_EXPIRY_MS = 86_400_000;

/** Decoded claims with the exact legacy field names. */
export interface LegacyJwtClaims {
  /** Subject: user email. */
  email: string;
  /** Shop UUID string, or null when unbound (e.g. SUPER_ADMIN). */
  shopId: string | null;
  /** ROLE_-prefixed authority name (UserPrincipal.getRole()). */
  role: string;
  /** DB session token, or null for pre-session tokens. */
  sessionId: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

export interface CreateJwtInput {
  email: string;
  role: string;
  shopId: string | null;
  sessionId?: string | null;
}

export class JwtInvalidError extends Error {
  readonly code: string = "JWT_INVALID";
}

export class JwtExpiredError extends JwtInvalidError {
  readonly code = "JWT_EXPIRED";
}

function secretKey(secret: string): Uint8Array {
  // Mirrors Keys.hmacShaKeyFor(secret.getBytes(UTF_8)) — raw UTF-8 bytes.
  return new TextEncoder().encode(secret);
}

export async function createJwt(
  secret: string,
  input: CreateJwtInput
): Promise<string> {
  assertServerRuntime("createJwt");
  const claims: Record<string, unknown> = {
    shopId: input.shopId,
    role: input.role,
  };
  if (input.sessionId != null) {
    claims["sessionId"] = input.sessionId;
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.email)
    .setIssuedAt()
    .setExpirationTime(new Date(Date.now() + JWT_EXPIRY_MS))
    .sign(secretKey(secret));
}

/**
 * Verifies signature + expiry. Throws JwtExpiredError on expiry,
 * JwtInvalidError on any other failure (bad signature, malformed, ...),
 * mirroring validateToken's fail-closed false on any JwtException.
 */
export async function verifyJwt(
  secret: string,
  token: string
): Promise<LegacyJwtClaims> {
  assertServerRuntime("verifyJwt");
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
    }));
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "ERR_JWT_EXPIRED"
    ) {
      throw new JwtExpiredError("Token is expired");
    }
    throw new JwtInvalidError("Invalid token");
  }
  if (typeof payload["sub"] !== "string") {
    throw new JwtInvalidError("Token has no subject");
  }
  return {
    email: payload["sub"],
    shopId:
      typeof payload["shopId"] === "string" ? payload["shopId"] : null,
    role: typeof payload["role"] === "string" ? payload["role"] : "",
    sessionId:
      typeof payload["sessionId"] === "string" ? payload["sessionId"] : null,
    issuedAt: new Date((payload["iat"] ?? 0) * 1000),
    expiresAt: new Date((payload["exp"] ?? 0) * 1000),
  };
}
