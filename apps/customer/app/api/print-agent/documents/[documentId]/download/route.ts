import { authenticateDocumentRequest } from "../../../../../../lib/documentRoutes.js";
import { serveAuthorizedDownload } from "../../../../../../lib/download.js";
import { fail } from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/print-agent/documents/:id/download — mirrors
// PrintAgentController.downloadDocument: API-key agent or JWT user,
// shop resolution with super-admin/param rules, same ownership + headers.
export async function GET(
  req: Request,
  { params }: { params: { documentId: string } }
) {
  try {
    const principal = await authenticateDocumentRequest(req);
    // requireAuthenticated already 401s anonymous callers.
    const role = principal.kind === "user" ? principal.role : "ROLE_PRINT_AGENT";
    const shopId = principal.shopId;
    return await serveAuthorizedDownload({
      kind: "agent",
      role,
      shopId,
      docId: params.documentId,
    });
  } catch (err) {
    return fail(err);
  }
}
