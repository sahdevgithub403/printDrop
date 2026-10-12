import { assertServerRuntime } from "../serverOnly.js";
import {
  assertAllowedExtension,
  assertSafeDisplayName,
  getFileExtension,
  verifyMagicBytes,
  FileValidationError,
} from "./magic.js";
import { calculatePageCount } from "./pageCount.js";
import { newStoredFileName, type StorageAdapter } from "./storage.js";

// Upload orchestration.
// Sources: FileStorageService.uploadFile/storeGeneratedBytes (validation
// order, cleanup-on-page-count-failure, UUID stored names, nullable
// contentType passthrough, edited-copy content-type default) +
// AdminDocumentService.uploadEditedCopy (source-access gate, parent
// lineage set post-save) + delete ordering (object-first, then nullify
// refs, then row delete; missing object = success).
// Sizes (application.yml): 20 MB/file, 25 MB/request. The Route layer
// enforces them during streaming (see apps/customer multipart helper);
// the byte counts here are defense-in-depth re-checks, never the primary
// gate, and use the exact legacy messages.

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
export const OVERSIZE_MESSAGE =
  "The file exceeds the maximum allowed size of 20 MB.";

export interface DocumentRow {
  id: string;
  originalFileName: string;
  storedFileName: string;
  contentType: string | null;
  fileSize: number;
  pageCount: number;
  uploadedAt: Date;
  shopId: string | null;
  parentDocumentId: string | null;
}

export interface DocumentDb {
  insertDocument(input: {
    originalFileName: string;
    storedFileName: string;
    contentType: string | null;
    fileSize: number;
    pageCount: number;
    uploadedAt: Date;
    shopId: string | null;
  }): Promise<DocumentRow>;
  setParentDocumentId(id: string, parentDocumentId: string): Promise<DocumentRow>;
  findDocumentById(id: string): Promise<DocumentRow | null>;
  nullifyDocumentReferences(documentId: string): Promise<void>;
  deleteDocumentRow(documentId: string): Promise<void>;
}

export interface IncomingFile {
  originalFileName: string;
  contentType: string | null;
  data: Uint8Array;
}

function assertSizeLimits(dataLength: number): void {
  if (dataLength > MAX_FILE_BYTES) {
    throw new FileValidationError(OVERSIZE_MESSAGE);
  }
}

export interface StoredDocument {
  row: DocumentRow;
}

/**
 * Mirrors uploadFile: validate -> stage bytes -> page count (cleanup on
 * failure) -> persist object -> insert row. Returns the stored row.
 */
export async function storeUpload(
  storage: StorageAdapter,
  db: DocumentDb,
  file: IncomingFile,
  shopId: string | null,
  opts: { editedCopy: boolean; now?: Date }
): Promise<StoredDocument> {
  assertServerRuntime("storeUpload");
  assertSizeLimits(file.data.length);
  const displayName = assertSafeDisplayName(
    file.originalFileName,
    opts.editedCopy ? "generated" : "upload"
  );
  const extension = getFileExtension(displayName).toLowerCase();
  assertAllowedExtension(extension, opts.editedCopy);
  verifyMagicBytes(file.data.subarray(0, 8), extension, displayName);

  const storedFileName = newStoredFileName(extension);
  const contentType =
    file.contentType ??
    (opts.editedCopy
      ? extension === "pdf"
        ? "application/pdf"
        : `image/${extension}`
      : null);

  let pageCount: number;
  try {
    pageCount = await calculatePageCount(file.data, extension, displayName);
  } catch (err) {
    // Legacy cleanup: staged bytes removed before the error surfaces;
    // no row is ever inserted on this path.
    await storage.remove(storedFileName).catch(() => undefined);
    throw err;
  }

  await storage.put(storedFileName, file.data, contentType ?? "application/octet-stream");
  const now = opts.now ?? new Date();
  try {
    const row = await db.insertDocument({
      originalFileName: displayName,
      storedFileName,
      contentType,
      fileSize: file.data.length,
      pageCount,
      uploadedAt: now,
      shopId,
    });
    return { row };
  } catch (err) {
    await storage.remove(storedFileName).catch(() => undefined);
    throw err;
  }
}

/**
 * Mirrors AdminDocumentService.uploadEditedCopy: the source-access gate
 * runs first ("Source document does not belong to your shop or does not
 * exist" 403); the original is never modified; lineage is set post-save.
 */
export async function storeEditedCopy(
  storage: StorageAdapter,
  db: DocumentDb,
  file: IncomingFile,
  shopId: string,
  sourceDocumentId: string | null,
  hasAccess: (shopId: string, documentId: string) => Promise<boolean>,
  opts?: { now?: Date }
): Promise<StoredDocument> {
  assertServerRuntime("storeEditedCopy");
  if (file.data.length === 0) {
    throw new FileValidationError("Edited file is missing");
  }
  if (
    sourceDocumentId != null &&
    !(await hasAccess(shopId, sourceDocumentId))
  ) {
    const err = new Error(
      "Source document does not belong to your shop or does not exist"
    ) as Error & { status: 403 };
    err.status = 403;
    throw err;
  }
  const stored = await storeUpload(storage, db, file, shopId, {
    editedCopy: true,
    now: opts?.now,
  });
  if (sourceDocumentId != null) {
    const row = await db.setParentDocumentId(
      stored.row.id,
      sourceDocumentId
    );
    return { row };
  }
  return stored;
}

/**
 * Mirrors the single-delete ordering: object-first; DB refs only touched
 * when the object delete succeeded (else 500, row preserved). Missing
 * objects count as success so cleanup proceeds.
 */
export async function deleteStoredDocument(
  storage: StorageAdapter,
  db: DocumentDb,
  storedFileName: string,
  documentId: string
): Promise<void> {
  assertServerRuntime("deleteStoredDocument");
  const removed = await storage.remove(storedFileName);
  if (!removed) {
    const err = new Error(
      "Failed to delete document file from storage; database record preserved"
    ) as Error & { status: 500 };
    err.status = 500;
    throw err;
  }
  await db.nullifyDocumentReferences(documentId);
  await db.deleteDocumentRow(documentId);
}

/**
 * Attachment header — byte-identical port of
 * AdminDocumentController.buildAttachmentHeader: strip CR/LF/quotes,
 * URLEncoder-style UTF-8 encoding (spaces as %20), RFC5987 filename*.
 */
export function buildAttachmentHeader(originalFileName: string | null): string {
  const safe = (originalFileName ?? "document").replace(/[\r\n"]/g, "_");
  try {
    const encoded = encodeURIComponent(safe).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
    return `attachment; filename="${safe.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`;
  } catch {
    return 'attachment; filename="document"';
  }
}

export function fallbackContentType(contentType: string | null): string {
  return contentType && contentType.length > 0
    ? contentType
    : "application/octet-stream";
}
