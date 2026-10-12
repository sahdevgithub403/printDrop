import { deleteAllShopDocuments, AuthorizationError } from "@printdrop/domain";
import { prismaAdminDocumentStore } from "../../../../../lib/adminDocStore.js";
import { getStorage } from "../../../../../lib/documentRoutes.js";
import { requestAdminPrincipal } from "../../../../../lib/requestAuth.js";
import { ok, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// DELETE /api/admin/documents/all — mirrors
// AdminDocumentController.deleteAllShopDocuments: 200
// "All eligible shop documents deleted" + counts.
export async function DELETE(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      throw new AuthorizationError(
        "User not authenticated or shop context missing",
        403
      );
    }
    const result = await deleteAllShopDocuments(
      prismaAdminDocumentStore,
      getStorage(),
      principal.shopId
    );
    return ok(result, "All eligible shop documents deleted");
  } catch (err) {
    return fail(err);
  }
}
