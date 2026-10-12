import { deleteDocument, AuthorizationError } from "@printdrop/domain";
import { prismaAdminDocumentStore } from "../../../../../lib/adminDocStore.js";
import { getStorage } from "../../../../../lib/documentRoutes.js";
import { requestAdminPrincipal } from "../../../../../lib/requestAuth.js";
import { ok, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// DELETE /api/admin/documents/:documentId — mirrors
// AdminDocumentController.deleteDocument: 200 "Document permanently deleted".
export async function DELETE(
  req: Request,
  { params }: { params: { documentId: string } }
) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      throw new AuthorizationError(
        "User not authenticated or shop context missing",
        403
      );
    }
    await deleteDocument(
      prismaAdminDocumentStore,
      getStorage(),
      principal.shopId,
      params.documentId
    );
    return ok(null, "Document permanently deleted");
  } catch (err) {
    return fail(err);
  }
}
