import {
  createPayment,
} from "@printdrop/domain";
import { paymentContext } from "../../../../../lib/paymentContext.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/public/payments/create — mirrors
// PublicPaymentController.createPayment: 200 "Payment initiated".
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const data = await createPayment(
      paymentContext(),
      b["orderId"],
      b["paymentMethod"],
      b["shopId"] ?? null
    );
    return ok(data, "Payment initiated");
  } catch (err) {
    return fail(err);
  }
}
