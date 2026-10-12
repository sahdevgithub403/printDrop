import { requestAdminPrincipal } from "../../../../../../lib/requestAuth.js";
import { serveAuthorizedDownload } from "../../../../../../lib/download.js";
import { fail } from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/admin/documents/:id/download — mirrors
// AdminDocumentController.downloadDocument: SHOP_ADMIN/SUPER_ADMIN JWT
// (+shop, super-admin bypass) only; order-ref ownership (orphans 403);
// attachment headers.
export async function GET(
  req: Request,
  { params }: { params: { documentId: string } }
) {
  try {
    const principal = await requestAdminPrincipal(req);
    return await serveAuthorizedDownload({
      kind: "admin",
      role: principal.role,
      shopId: principal.shopId,
      docId: params.documentId,
    });
  } catch (err) {
    return fail(err);
  }
}
