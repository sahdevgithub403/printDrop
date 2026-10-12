import {
  authenticateRequest,
  requireAuthenticated,
  requireAnyRole,
  ROLE_SHOP_ADMIN,
  ROLE_SUPER_ADMIN,
  ROLE_PRINT_AGENT,
  type RequestUser,
  type RequestAgent,
} from "@printdrop/domain";
import { prismaPrincipalStores } from "./principalStore.js";
import { loadServerEnv } from "@printdrop/domain";

// Route-level authentication shared by admin + print-agent endpoints.
// Mirrors the filter chain: API-key principals first, then JWT
// (Bearer + ACTIVE/unexpired session + DB user). Returns a role-tagged
// principal; routes apply SecurityConfig authority rules on top.

export interface AdminPrincipal {
  kind: "user";
  id: string;
  email: string;
  role: string;
  shopId: string | null;
}

export interface AgentPrincipal {
  kind: "agent";
  role: typeof ROLE_PRINT_AGENT;
  shopId: string;
}

export async function requestAdminPrincipal(
  req: Request
): Promise<AdminPrincipal> {
  const { jwtSecret } = loadServerEnv();
  const principal = requireAuthenticated(
    await authenticateRequest(prismaPrincipalStores, req.headers, jwtSecret)
  );
  if (principal.kind !== "user") {
    const { AuthorizationError } = await import("@printdrop/domain");
    throw new AuthorizationError("Forbidden access: insufficient role", 403);
  }
  requireAnyRole(principal, ROLE_SHOP_ADMIN, ROLE_SUPER_ADMIN);
  return principal as AdminPrincipal;
}

export async function requestAgentPrincipal(
  req: Request
): Promise<AdminPrincipal | AgentPrincipal> {
  const { jwtSecret } = loadServerEnv();
  const principal = requireAuthenticated(
    await authenticateRequest(prismaPrincipalStores, req.headers, jwtSecret)
  );
  if (principal.kind === "agent") {
    return {
      kind: "agent",
      role: ROLE_PRINT_AGENT,
      shopId: principal.shopId,
    };
  }
  requireAnyRole(principal, ROLE_SHOP_ADMIN, ROLE_SUPER_ADMIN, ROLE_PRINT_AGENT);
  return principal as AdminPrincipal;
}

export function toTenantPrincipal(p: AdminPrincipal | AgentPrincipal): {
  role: string;
  shopId: string | null;
} {
  return { role: p.role, shopId: p.shopId };
}

export type { RequestUser, RequestAgent };
