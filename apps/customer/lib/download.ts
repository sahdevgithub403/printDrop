import {
  buildAttachmentHeader,
  fallbackContentType,
  AuthorizationError,
  ROLE_SUPER_ADMIN,
} from "@printdrop/domain";
import {
  prismaDocumentDb,
  orderRefAccess,
} from "./documentStore.js";
import {
  getStorage,
  authenticateDocumentRequest,
} from "./documentRoutes.js";

export const runtime = "nodejs";

// Shared authorized-download flow: ownership check first (order-ref only —
// orphans 403, super-admin bypass), then row lookup (super-admin unknown
// id -> 400 "Document not found"), then delivery. The default path streams
// bytes through this Route Handler (byte-identical to legacy, no client,
// CORS, or Electron-CSP changes). Presigned R2 URLs remain available via
// the adapter for future opt-in, but the default path never redirects.
export async function serveAuthorizedDownload(
  opts:
    | { kind: "admin"; role: string; shopId: string | null; docId: string }
    | { kind: "agent"; role: string; shopId: string | null; docId: string }
): Promise<Response> {
  const storage = getStorage();
  const forAdmin = opts.kind === "admin";

  // PrintAgentController.downloadDocument: resolveShopId(auth, null) leaves
  // an unbound super-admin with null context -> 403 (no bypass there).
  if (!forAdmin && opts.role === ROLE_SUPER_ADMIN && opts.shopId == null) {
    throw new AuthorizationError(
      "Shop context is required to download documents",
      403
    );
  }

  if (opts.shopId == null && opts.role !== ROLE_SUPER_ADMIN) {
    throw new AuthorizationError(
      forAdmin
        ? "User not authenticated or shop context missing"
        : "Shop context is required to download documents",
      403
    );
  }
  if (opts.role !== ROLE_SUPER_ADMIN) {
    const hasAccess = await orderRefAccess(opts.shopId!, opts.docId);
    if (!hasAccess) {
      throw new AuthorizationError(
        forAdmin
          ? "Document does not belong to any orders in your shop"
          : "Unauthorized: Document does not belong to any orders in your shop",
        403
      );
    }
  }
  const row = await prismaDocumentDb.findDocumentById(opts.docId);
  if (row == null) {
    const err = new Error("Document not found") as Error & { status: 400 };
    err.status = 400;
    throw err;
  }

  const disposition = buildAttachmentHeader(row.originalFileName);
  const contentType = fallbackContentType(row.contentType);
  const bytes = await storage.get(row.storedFileName);
  if (bytes == null) {
    // Legacy loadFileAsResource throws (500 generic) when the bytes are
    // gone even though the row exists.
    const err = new Error("An internal server error occurred") as Error & {
      status: 500;
    };
    err.status = 500;
    throw err;
  }
  return new Response(
    // Undici accepts Uint8Array at runtime; the cast satisfies the DOM
    // lib's narrower BodyInit spelling on this toolchain.
    bytes as unknown as BodyInit,
    {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
      },
    }
  );
}
