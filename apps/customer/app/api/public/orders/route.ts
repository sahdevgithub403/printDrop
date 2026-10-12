import { createOrder, liveRazorpayGateway, readRazorpayConfig } from "@printdrop/domain";
import { prismaOrderStore } from "../../../../lib/orderStore.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/public/orders — mirrors PublicOrderController.createOrder:
// 200 "Print order created successfully" | 400 validation/service |
// 503 unconfigured ONLINE | 500 Razorpay failures.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const data = await createOrder(
      { store: prismaOrderStore, razorpay: liveRazorpayGateway(readRazorpayConfig()) },
      {
        shopId: b["shopId"],
        paymentMethod: b["paymentMethod"],
        customerName: b["customerName"],
        customerPhone: b["customerPhone"],
        items: b["items"],
        documentId: b["documentId"],
        printType: b["printType"],
        colorMode: b["colorMode"],
        paperSize: b["paperSize"],
        printSide: b["printSide"],
        pageRange: b["pageRange"],
        copies: b["copies"],
      }
    );
    return ok(data, "Print order created successfully");
  } catch (err) {
    return fail(err);
  }
}
