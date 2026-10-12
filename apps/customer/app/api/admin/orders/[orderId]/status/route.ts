import { updatePrintStatus, OrderError } from "@printdrop/domain";
import { prismaOrderStore } from "../../../../../../lib/orderStore.js";
import { guardedOrder } from "../../../../../../lib/orderGuard.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// PATCH /api/admin/orders/:orderId/status — mirrors
// AdminOrderController.updatePrintStatus: null -> 400 "Print status is
// required" (@NotNull message, before the service check); 200
// "Order status updated".
export async function PATCH(
  req: Request,
  { params }: { params: { orderId: string } }
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
    const data = await updatePrintStatus(
      { store: prismaOrderStore },
      params.orderId,
      printStatus
    );
    void principal;
    return ok(data, "Order status updated");
  } catch (err) {
    return fail(err);
  }
}

