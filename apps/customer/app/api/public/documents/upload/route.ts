import { storeUpload } from "@printdrop/domain";
import { prismaDocumentDb, findShopIdBySlug } from "../../../../../lib/documentStore.js";
import { getStorage } from "../../../../../lib/documentRoutes.js";
import {
  parseMultipart,
  requireFirstFile,
  MultipartError,
} from "../../../../../lib/multipart.js";
import { ok, badRequest, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/public/documents/upload — mirrors PublicDocumentController:
// multipart `file` + optional shopId/shopSlug binding; 200
// "Document uploaded successfully" + DocumentDTO.
export async function POST(req: Request) {
  try {
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
    const rawShopId = (parsed.fields["shopId"] ?? "").trim();
    const rawSlug = (parsed.fields["shopSlug"] ?? "").trim();
    let boundShopId: string | null = null;
    if (rawShopId.length > 0) {
      // Spring rejects unconvertible UUID params with an empty 400;
      // the closest envelope-preserving equivalent is documented here.
      if (!UUID_PATTERN.test(rawShopId)) {
        return badRequest("Invalid shop ID");
      }
      boundShopId = rawShopId;
    } else if (rawSlug.length > 0) {
      boundShopId = await findShopIdBySlug(rawSlug);
    }

    const { row } = await storeUpload(
      getStorage(),
      prismaDocumentDb,
      {
        originalFileName: file.originalFileName,
        contentType: file.contentType,
        data: file.data,
      },
      boundShopId,
      { editedCopy: false }
    );
    return ok(
      {
        id: row.id,
        originalFileName: row.originalFileName,
        contentType: row.contentType,
        fileSize: row.fileSize,
        pageCount: row.pageCount,
        uploadedAt: row.uploadedAt.toISOString(),
      },
      "Document uploaded successfully"
    );
  } catch (err) {
    if (err instanceof MultipartError) {
      return badRequest(err.message);
    }
    return fail(err);
  }
}
