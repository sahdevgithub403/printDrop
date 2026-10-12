import { getOrderById, canAccessShopOrder, AuthorizationError } from "@printdrop/domain";
import { prismaOrderStore } from "./orderStore.js";
import { requestAdminPrincipal } from "./requestAuth.js";

// Shared admin order guard: authenticated admin principal + tenant-scoped
// order load (super-admin bypass, cross-shop 403). Mirrors
// AdminOrderController's per-endpoint preamble.
export async function guardedOrder(req: Request, orderId: string) {
  const principal = await requestAdminPrincipal(req);
  const order = await getOrderById(prismaOrderStore, orderId);
  if (
    !canAccessShopOrder(
      { role: principal.role, shopId: principal.shopId },
      order.shopId
    )
  ) {
    throw new AuthorizationError("Unauthorized access to shop order", 403);
  }
  return { principal, order };
}
