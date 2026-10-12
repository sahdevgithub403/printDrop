import { deleteBulkDocuments, AuthorizationError } from "@printdrop/domain";
import { prismaAdminDocumentStore } from "../../../../../lib/adminDocStore.js";
import { getStorage } from "../../../../../lib/documentRoutes.js";
import { requestAdminPrincipal } from "../../../../../lib/requestAuth.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// DELETE /api/admin/documents/bulk — mirrors
// AdminDocumentController.deleteBulkDocuments: tolerant {documentIds}
// parsing; 200 {deletedCount}.
export async function DELETE(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      throw new AuthorizationError(
        "User not authenticated or shop context missing",
        403
      );
    }
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const documentIds: string[] = [];
    const raw =
      body != null && typeof body === "object"
        ? (body as Record<string, unknown>)["documentIds"]
        : undefined;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string" && item.trim().length > 0) {
          if (
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              item.trim()
            )
          ) {
            documentIds.push(item.trim());
          }
        }
      }
    }
    const deletedCount = await deleteBulkDocuments(
      prismaAdminDocumentStore,
      getStorage(),
      principal.shopId,
      documentIds
    );
    return ok({ deletedCount }, "Bulk deletion completed");
  } catch (err) {
    return fail(err);
  }
}
