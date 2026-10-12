import { cancelPayment, OrderError } from "@printdrop/domain";
import { paymentContext } from "../../../../../lib/paymentContext.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/public/payments/cancel — mirrors
// PublicPaymentController.cancelPayment: 200 "Payment marked as cancelled".
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const orderIdStr = b["orderId"];
    if (typeof orderIdStr !== "string" || orderIdStr.trim().length === 0) {
      throw new OrderError("orderId is required", 400);
    }
    if (!UUID_PATTERN.test(orderIdStr.trim())) {
      throw new OrderError(`Invalid UUID string: ${orderIdStr}`, 400);
    }
    const data = await cancelPayment(
      paymentContext(),
      orderIdStr.trim(),
      b["razorpayOrderId"]
    );
    return ok(data, "Payment marked as cancelled");
  } catch (err) {
    return fail(err);
  }
}
