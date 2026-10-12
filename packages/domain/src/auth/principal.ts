import { assertServerRuntime } from "../serverOnly.js";
import { verifyJwt } from "./jwt.js";
import { resolveSessionId } from "./session.js";
import { AuthorizationError } from "./authorization.js";

// Request authentication for shop-scoped routes.
// Sources: PrintAgentApiKeyFilter (API-key check runs BEFORE JWT; headers
// X-Agent-Key / X-API-Key / "Authorization: ApiKey <key>"; plaintext shop
// lookup) + JwtAuthenticationFilter (Bearer extraction; invalid -> 401
// "Invalid or expired token"; session check -> 401 "Session is invalid or
// expired") + SecurityConfig entry point (no credentials on protected
// routes -> 401 "Unauthorized access: ...").
// The 401 no-credentials message mirrors Spring's default
// ("Full authentication is required to access this resource"); theExact
// wording is framework-version dependent and noted as approximate.

export interface RequestUser {
  kind: "user";
  id: string;
  email: string;
  role: string;
  shopId: string | null;
}

export interface RequestAgent {
  kind: "agent";
  shopId: string;
}

export type RequestPrincipal = RequestUser | RequestAgent;

export interface PrincipalStores {
  findUserByEmail(email: string): Promise<{
    id: string;
    role: string;
    shopId: string | null;
  } | null>;
  findShopIdByApiKey(apiKey: string): Promise<string | null>;
  findSessionByToken(
    sessionToken: string
  ): Promise<{ id: string; status: string; expiresAt: Date } | null>;
}

function extractApiKey(headers: Headers): string | null {
  const direct =
    headers.get("X-Agent-Key") ?? headers.get("X-API-Key");
  if (direct != null && direct.trim().length > 0) {
    return direct.trim();
  }
  const auth = headers.get("Authorization") ?? "";
  if (auth.startsWith("ApiKey ")) {
    const key = auth.substring(7).trim();
    return key.length > 0 ? key : null;
  }
  return null;
}

function extractBearer(headers: Headers): string | null {
  const auth = headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.substring(7);
    return token.length > 0 ? token : null;
  }
  return null;
}

/**
 * Returns the authenticated principal, or null when no credentials were
 * presented (protected routes turn that into 401). API-key principals
 * resolve first, mirroring the filter order.
 */
export async function authenticateRequest(
  stores: PrincipalStores,
  headers: Headers,
  jwtSecret: string,
  now: Date = new Date()
): Promise<RequestPrincipal | null> {
  assertServerRuntime("authenticateRequest");
  const apiKey = extractApiKey(headers);
  if (apiKey != null) {
    const shopId = await stores.findShopIdByApiKey(apiKey);
    if (shopId != null) {
      return { kind: "agent", shopId };
    }
    // Unknown key: fall through to JWT handling like the filter chain
    // (no authentication set -> downstream 401/403 rules apply).
  }
  const token = extractBearer(headers);
  if (token == null) {
    return null;
  }
  let claims;
  try {
    claims = await verifyJwt(jwtSecret, token);
  } catch {
    throw new AuthorizationError("Invalid or expired token", 401);
  }
  const sessionId = await resolveSessionId(
    { findBySessionToken: (t) => stores.findSessionByToken(t) },
    claims.sessionId,
    now
  ).catch(() => {
    throw new AuthorizationError("Session is invalid or expired", 401);
  });
  void sessionId;
  const user = await stores.findUserByEmail(claims.email);
  if (user == null) {
    throw new AuthorizationError("Invalid or expired token", 401);
  }
  return {
    kind: "user",
    id: user.id,
    email: claims.email,
    role: claims.role || user.role,
    shopId: user.shopId,
  };
}

export function requireAuthenticated(
  principal: RequestPrincipal | null
): RequestPrincipal {
  if (principal == null) {
    throw new AuthorizationError(
      "Unauthorized access: Full authentication is required to access this resource",
      401
    );
  }
  return principal;
}
