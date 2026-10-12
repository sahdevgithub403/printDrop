import { calculatePrice } from "@printdrop/domain";
import { prismaPricingStore } from "../../../../../lib/publicStore.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/public/pricing/calculate — mirrors
// PublicPricingController.calculatePrice: 200 breakdown | 400
// validation/service | 500 arithmetic overflow.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const data = await calculatePrice(prismaPricingStore, {
      shopId: b["shopId"],
      documentId: b["documentId"],
      printType: b["printType"],
      colorMode: b["colorMode"],
      paperSize: b["paperSize"],
      printSide: b["printSide"],
      pageRange: b["pageRange"],
      copies: b["copies"],
    });
    return ok(data, "Success");
  } catch (err) {
    return fail(err);
  }
}

