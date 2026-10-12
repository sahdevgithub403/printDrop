import { getShopOrders, AuthorizationError } from "@printdrop/domain";
import { prismaOrderStore } from "../../../../lib/orderStore.js";
import { requestAdminPrincipal } from "../../../../lib/requestAuth.js";
import { ok, fail } from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/admin/orders?status= — mirrors
// AdminOrderController.getShopOrders: null shop + non-super -> 403;
// super without shop -> 400; invalid filter -> 400.
export async function GET(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    const shopId = principal.shopId;
    if (shopId == null) {
      if (principal.role !== "ROLE_SUPER_ADMIN") {
        throw new AuthorizationError(
          "User is not associated with any shop",
          403
        );
      }
      throw new AuthorizationError(
        "Super admin must provide shop context to list orders",
        400
      );
    }
    const { searchParams } = new URL(req.url);
    const data = await getShopOrders(
      prismaOrderStore,
      shopId,
      searchParams.get("status")
    );
    return ok(data, "Success");
  } catch (err) {
    return fail(err);
  }
}
