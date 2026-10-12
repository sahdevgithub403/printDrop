import { assertServerRuntime } from "../serverOnly.js";

// Tenant + role authorization helpers.
// Sources:
// - AdminOrderController.canAccessShopOrder: super-admin bypasses the
//   tenant check (read-only); otherwise the principal's shopId must equal
//   the order's shopId. List path: null shopId + non-super -> 403
//   "User is not associated with any shop"; super-admin without shop ->
//   400 "Super admin must provide shop context to list orders".
//   Cross-shop access -> 403 "Unauthorized access to shop order".
// - PrintAgentController.extractShopId/resolveShopId: unknown/missing
//   principal -> 403; PRINT_AGENT (PrintAgentPrincipal) and JWT users both
//   resolve to their bound shopId; non-super cross-shop request -> 403
//   "Unauthorized: Cannot access print jobs of another shop"; super-admin
//   without binding scopes via the explicit request param.
// - SecurityConfig: /api/admin/** requires ROLE_SHOP_ADMIN/SUPER_ADMIN;
//   /api/print-agent/** additionally allows ROLE_PRINT_AGENT.

export const ROLE_SHOP_ADMIN = "ROLE_SHOP_ADMIN";
export const ROLE_SUPER_ADMIN = "ROLE_SUPER_ADMIN";
export const ROLE_PRINT_AGENT = "ROLE_PRINT_AGENT";

/** Minimal authenticated-principal view (JWT user or API-key agent). */
export interface Principal {
  role: string;
  /** Bound shop UUID string, or null when unbound (SUPER_ADMIN). */
  shopId: string | null;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403
  ) {
    super(message);
  }
}

export function isSuperAdmin(principal: Principal | null): boolean {
  return principal?.role === ROLE_SUPER_ADMIN;
}

/**
 * Mirrors canAccessShopOrder: super-admin bypass, otherwise exact
 * shopId equality (null principal shop never matches).
 */
export function canAccessShopOrder(
  principal: Principal | null,
  orderShopId: string
): boolean {
  assertServerRuntime("canAccessShopOrder");
  if (principal == null) {
    return false;
  }
  return (
    isSuperAdmin(principal) ||
    (principal.shopId != null && principal.shopId === orderShopId)
  );
}

/** Throws the legacy 403 message on cross-shop access. */
export function requireShopOrderAccess(
  principal: Principal | null,
  orderShopId: string
): void {
  assertServerRuntime("requireShopOrderAccess");
  if (!canAccessShopOrder(principal, orderShopId)) {
    throw new AuthorizationError("Unauthorized access to shop order", 403);
  }
}

/**
 * Mirrors the admin list scoping: returns the effective shopId, or throws
 * 403 (unbound non-super) / 400 (super-admin without context).
 */
export function resolveListShopId(principal: Principal | null): string {
  assertServerRuntime("resolveListShopId");
  const shopId = principal?.shopId ?? null;
  if (shopId != null) {
    return shopId;
  }
  if (principal != null && isSuperAdmin(principal)) {
    throw new AuthorizationError(
      "Super admin must provide shop context to list orders",
      400
    );
  }
  throw new AuthorizationError("User is not associated with any shop", 403);
}

/**
 * Mirrors PrintAgentController.resolveShopId for shop-bound callers:
 * unbound non-super -> 403; cross-shop request -> 403; super-admin
 * without binding uses the explicit requested shop (null stays null so
 * callers can raise "shop context required"), otherwise the bound shop.
 */
export function resolveAgentShopId(
  principal: Principal | null,
  requestedShopId: string | null
): string | null {
  assertServerRuntime("resolveAgentShopId");
  if (principal == null) {
    throw new AuthorizationError(
      "Unauthorized: No authentication principal found",
      403
    );
  }
  const authShopId = principal.shopId;
  if (authShopId == null) {
    if (isSuperAdmin(principal)) {
      return requestedShopId;
    }
    throw new AuthorizationError(
      "Authenticated agent is not bound to any shop",
      403
    );
  }
  if (
    requestedShopId != null &&
    requestedShopId !== authShopId &&
    !isSuperAdmin(principal)
  ) {
    throw new AuthorizationError(
      "Unauthorized: Cannot access print jobs of another shop",
      403
    );
  }
  return requestedShopId != null && isSuperAdmin(principal)
    ? requestedShopId
    : authShopId;
}

/** Route-level role gate (SecurityConfig authority rules). */
export function requireAnyRole(
  principal: Principal | null,
  ...allowed: string[]
): void {
  assertServerRuntime("requireAnyRole");
  if (principal == null || !allowed.includes(principal.role)) {
    throw new AuthorizationError(
      "Forbidden access: insufficient role",
      403
    );
  }
}
