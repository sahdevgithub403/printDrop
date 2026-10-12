import { getItemDocumentVersions } from "@printdrop/domain";
import { prismaOrderStore } from "../../../../../../../../lib/orderStore.js";
import { guardedOrder } from "../../../../../../../../lib/orderGuard.js";
import { ok, fail } from "../../../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/admin/orders/:orderId/items/:itemId/versions — mirrors
// getItemDocumentVersions (root + siblings + current flags).
export async function GET(
  req: Request,
  { params }: { params: { orderId: string; itemId: string } }
) {
  try {
    const { principal } = await guardedOrder(req, params.orderId);
    const data = await getItemDocumentVersions(
      { store: prismaOrderStore },
      params.orderId,
      params.itemId,
      principal.shopId
    );
    return ok(data, "Success");
  } catch (err) {
    return fail(err);
  }
}

