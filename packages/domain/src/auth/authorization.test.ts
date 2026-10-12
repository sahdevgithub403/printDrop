import { describe, expect, it } from "vitest";
import {
  canAccessShopOrder,
  requireShopOrderAccess,
  resolveListShopId,
  resolveAgentShopId,
  requireAnyRole,
  AuthorizationError,
  ROLE_SHOP_ADMIN,
  ROLE_SUPER_ADMIN,
  ROLE_PRINT_AGENT,
} from "./authorization.js";

const SHOP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("tenant isolation (canAccessShopOrder / resolveShopId)", () => {
  it("allows same-shop access, denies cross-shop and anonymous", () => {
    expect(
      canAccessShopOrder({ role: ROLE_SHOP_ADMIN, shopId: SHOP_A }, SHOP_A)
    ).toBe(true);
    expect(
      canAccessShopOrder({ role: ROLE_SHOP_ADMIN, shopId: SHOP_A }, SHOP_B)
    ).toBe(false);
    expect(canAccessShopOrder(null, SHOP_A)).toBe(false);
    expect(
      canAccessShopOrder({ role: ROLE_SHOP_ADMIN, shopId: null }, SHOP_A)
    ).toBe(false);
  });

  it("lets SUPER_ADMIN bypass the tenant check (read-only)", () => {
    expect(
      canAccessShopOrder({ role: ROLE_SUPER_ADMIN, shopId: null }, SHOP_B)
    ).toBe(true);
    expect(() =>
      requireShopOrderAccess({ role: ROLE_SHOP_ADMIN, shopId: SHOP_A }, SHOP_B)
    ).toThrowError(/Unauthorized access to shop order/);
    try {
      requireShopOrderAccess({ role: ROLE_SHOP_ADMIN, shopId: SHOP_A }, SHOP_B);
      expect.unreachable();
    } catch (err) {
      expect((err as AuthorizationError).status).toBe(403);
    }
  });

  it("scopes list reads: bound shop returned, unbound non-super 403, super-without-context 400", () => {
    expect(
      resolveListShopId({ role: ROLE_SHOP_ADMIN, shopId: SHOP_A })
    ).toBe(SHOP_A);
    expect(() => resolveListShopId({ role: ROLE_SHOP_ADMIN, shopId: null }))
      .toThrowError(/not associated with any shop/);
    try {
      resolveListShopId({ role: ROLE_SHOP_ADMIN, shopId: null });
      expect.unreachable();
    } catch (err) {
      expect((err as AuthorizationError).status).toBe(403);
    }
    try {
      resolveListShopId({ role: ROLE_SUPER_ADMIN, shopId: null });
      expect.unreachable();
    } catch (err) {
      const e = err as AuthorizationError;
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/shop context/);
    }
  });

  it("resolves print-agent shops: bound, cross-shop 403, super via param", () => {
    // PRINT_AGENT API-key principal bound to SHOP_A.
    expect(
      resolveAgentShopId({ role: ROLE_PRINT_AGENT, shopId: SHOP_A }, null)
    ).toBe(SHOP_A);
    expect(
      resolveAgentShopId({ role: ROLE_PRINT_AGENT, shopId: SHOP_A }, SHOP_A)
    ).toBe(SHOP_A);
    expect(() =>
      resolveAgentShopId({ role: ROLE_PRINT_AGENT, shopId: SHOP_A }, SHOP_B)
    ).toThrowError(/another shop/);
    // Super-admin without binding scopes via the explicit param.
    expect(
      resolveAgentShopId({ role: ROLE_SUPER_ADMIN, shopId: null }, SHOP_B)
    ).toBe(SHOP_B);
    expect(() => resolveAgentShopId(null, SHOP_A)).toThrowError(
      /No authentication principal/
    );
    expect(() =>
      resolveAgentShopId({ role: ROLE_SHOP_ADMIN, shopId: null }, null)
    ).toThrowError(/not bound to any shop/);
  });

  it("gates routes by ROLE_ authority", () => {
    expect(() =>
      requireAnyRole(
        { role: ROLE_SHOP_ADMIN, shopId: SHOP_A },
        ROLE_SHOP_ADMIN,
        ROLE_SUPER_ADMIN
      )
    ).not.toThrow();
    expect(() =>
      requireAnyRole(
        { role: ROLE_PRINT_AGENT, shopId: SHOP_A },
        ROLE_SHOP_ADMIN,
        ROLE_SUPER_ADMIN
      )
    ).toThrowError(/insufficient role/);
    expect(() => requireAnyRole(null, ROLE_SHOP_ADMIN)).toThrowError(
      /insufficient role/
    );
  });
});
