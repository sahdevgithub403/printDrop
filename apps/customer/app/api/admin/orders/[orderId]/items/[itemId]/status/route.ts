import { updateItemPrintStatus, OrderError } from "@printdrop/domain";
import { prismaOrderStore } from "../../../../../../../../lib/orderStore.js";
import { guardedOrder } from "../../../../../../../../lib/orderGuard.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// PATCH /api/admin/orders/:orderId/items/:itemId/status — mirrors
// updateItemPrintStatus: 200 "Item print status updated".
export async function PATCH(
  req: Request,
  { params }: { params: { orderId: string; itemId: string } }
) {
  try {
    const { principal } = await guardedOrder(req, params.orderId);
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const printStatus = (body as Record<string, unknown> | null)?.[
      "printStatus"
    ];
    if (printStatus == null) {
      throw new OrderError("Print status is required", 400);
    }
    const data = await updateItemPrintStatus(
      { store: prismaOrderStore },
      params.orderId,
      params.itemId,
      printStatus,
      principal.shopId
    );
    return ok(data, "Item print status updated");
  } catch (err) {
    return fail(err);
  }
}

