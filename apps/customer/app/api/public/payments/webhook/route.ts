import { NextResponse } from "next/server";
import { handleWebhook } from "@printdrop/domain";
import { paymentContext } from "../../../../../lib/paymentContext.js";
import { fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/public/payments/webhook — mirrors
// PublicPaymentController.handleWebhook: raw body + X-Razorpay-Signature,
// 200 {status:"ok"} (plain map, NOT the ApiResponse envelope).
export async function POST(req: Request) {
  try {
    const rawPayload = await req.text();
    const signature = req.headers.get("X-Razorpay-Signature");
    const result = await handleWebhook(paymentContext(), rawPayload, signature);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return fail(err);
  }
}
