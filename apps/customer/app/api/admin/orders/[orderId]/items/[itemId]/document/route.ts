import { swapItemDocument, OrderError } from "@printdrop/domain";
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/admin/orders/:orderId/items/:itemId/document — mirrors
// swapItemDocument: 400 missing/malformed documentId, 409 paid/printing,
// 200 "Item document updated".
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
    const documentIdStr = (body as Record<string, unknown> | null)?.[
      "documentId"
    ];
    if (typeof documentIdStr !== "string" || documentIdStr.trim().length === 0) {
      throw new OrderError("documentId is required", 400);
    }
    if (!UUID_PATTERN.test(documentIdStr.trim())) {
      throw new OrderError("Invalid documentId", 400);
    }
    const data = await swapItemDocument(
      { store: prismaOrderStore },
      params.orderId,
      params.itemId,
      documentIdStr.trim(),
      principal.shopId
    );
    return ok(data, "Item document updated");
  } catch (err) {
    return fail(err);
  }
}

