import { deleteOrder } from "@printdrop/domain";
import { prismaOrderStore } from "../../../../../lib/orderStore.js";
import { requestAdminPrincipal } from "../../../../../lib/requestAuth.js";
import { guardedOrder } from "../../../../../lib/orderGuard.js";
import { ok, fail } from "../../../../../lib/authRoutes.js";
import { AuthorizationError } from "@printdrop/domain";

export const runtime = "nodejs";

// GET /api/admin/orders/:orderId — 403 on cross-shop access.
export async function GET(
  req: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    const { order } = await guardedOrder(req, params.orderId);
    return ok(order, "Success");
  } catch (err) {
    return fail(err);
  }
}

// DELETE /api/admin/orders/:orderId?confirm= — mirrors
// AdminOrderController.deleteOrder: shop-less -> 403; 409 guards;
// 200 "Order deleted successfully".
export async function DELETE(
  req: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      throw new AuthorizationError(
        "User is not associated with any shop",
        403
      );
    }
    const { searchParams } = new URL(req.url);
    const confirm = searchParams.get("confirm") === "true";
    await deleteOrder(
      { store: prismaOrderStore },
      params.orderId,
      principal.shopId,
      confirm
    );
    return ok(null, "Order deleted successfully");
  } catch (err) {
    return fail(err);
  }
}
