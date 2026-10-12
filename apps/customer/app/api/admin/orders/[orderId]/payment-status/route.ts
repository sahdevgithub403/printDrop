import { updatePaymentStatus, OrderError } from "@printdrop/domain";
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

const PAYMENT_STATUSES = new Set(["PENDING", "PAID", "FAILED", "REFUNDED"]);

// PATCH /api/admin/orders/:orderId/payment-status — mirrors
// updatePaymentStatus: missing -> 400 "paymentStatus is required";
// unknown -> 400 "Invalid paymentStatus: <raw>"; 200 "Payment status updated".
export async function PATCH(
  req: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    await guardedOrder(req, params.orderId);
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const raw = (body as Record<string, unknown> | null)?.["paymentStatus"];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new OrderError("paymentStatus is required", 400);
    }
    const upper = raw.trim().toUpperCase();
    if (!PAYMENT_STATUSES.has(upper)) {
      throw new OrderError(`Invalid paymentStatus: ${raw}`, 400);
    }
    const data = await updatePaymentStatus(
      { store: prismaOrderStore },
      params.orderId,
      upper
    );
    return ok(data, "Payment status updated");
  } catch (err) {
    return fail(err);
  }
}

