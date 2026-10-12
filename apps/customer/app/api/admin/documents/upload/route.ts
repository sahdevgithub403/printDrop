import { storeEditedCopy, AuthorizationError } from "@printdrop/domain";
import {
  prismaDocumentDb,
  documentAccess,
} from "../../../../../lib/documentStore.js";
import { getStorage } from "../../../../../lib/documentRoutes.js";
import { requestAdminPrincipal } from "../../../../../lib/requestAuth.js";
import {
  parseMultipart,
  requireFirstFile,
  MultipartError,
} from "../../../../../lib/multipart.js";
import { ok, badRequest, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/admin/documents/upload — mirrors
// AdminDocumentController.uploadEditedCopy: SHOP_ADMIN/SUPER_ADMIN JWT
// user + shop required (API-key agents rejected by role gate);
// 200 "Edited copy saved" + AdminDocumentDTO (order fields N/A).
export async function POST(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      throw new AuthorizationError(
        "User not authenticated or shop context missing",
        403
      );
    }
    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (err) {
      if (err instanceof MultipartError) {
        return badRequest(err.message);
      }
      throw err;
    }
    const file = requireFirstFile(parsed);
    const rawSource = (parsed.fields["sourceDocumentId"] ?? "").trim();
    const sourceDocumentId = rawSource.length > 0 ? rawSource : null;

    const { row } = await storeEditedCopy(
      getStorage(),
      prismaDocumentDb,
      {
        originalFileName: file.originalFileName,
        contentType: file.contentType,
        data: file.data,
      },
      principal.shopId,
      sourceDocumentId,
      (shopId, documentId) => documentAccess(shopId, documentId)
    );
    return ok(
      {
        id: row.id,
        originalFileName: row.originalFileName,
        contentType: row.contentType,
        fileSize: row.fileSize,
        pageCount: row.pageCount,
        uploadedAt: row.uploadedAt.toISOString(),
        orderId: null,
        orderNumber: "N/A",
        customerName: "Walk-in",
        orderPrintStatus: "PENDING",
        canDelete: true,
        isProcessing: false,
        parentDocumentId: row.parentDocumentId,
      },
      "Edited copy saved"
    );
  } catch (err) {
    if (err instanceof MultipartError) {
      return badRequest(err.message);
    }
    return fail(err);
  }
}
