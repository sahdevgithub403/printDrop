import { assertServerRuntime } from "../serverOnly.js";

// File validation: extensions + magic-byte sniffing.
// Source: backend/.../service/FileStorageService.java —
// ALLOWED_EXTENSIONS pdf/jpg/jpeg/png/doc/docx; EDITED_COPY_EXTENSIONS
// pdf/jpg/jpeg/png (MAX_EDITED_COPY_BYTES 20MB); verifyMagicBytes switch
// with per-type messages; getFileExtension (lowercased by callers).
// All messages below are byte-identical to the legacy strings.

export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "doc",
  "docx",
]);

export const EDITED_COPY_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
]);

export const MAX_EDITED_COPY_BYTES = 20 * 1024 * 1024;

export class FileValidationError extends Error {
  constructor(
    message: string,
    readonly status: 400 = 400
  ) {
    super(message);
  }
}

export function getFileExtension(fileName: string | null | undefined): string {
  if (fileName == null) {
    return "";
  }
  const lastIndex = fileName.lastIndexOf(".");
  return lastIndex === -1 ? "" : fileName.substring(lastIndex + 1);
}

/** C-08/path guard shared with deletion: rejects traversal sequences. */
export function assertSafeDisplayName(
  originalFileName: string,
  what: "upload" | "generated"
): string {
  const clean = originalFileName.trim();
  if (clean.length === 0 || clean.includes("..")) {
    throw new FileValidationError(
      what === "upload"
        ? `Filename contains invalid path sequence ${originalFileName}`
        : "Invalid generated file name"
    );
  }
  return clean;
}

export function assertAllowedExtension(
  extension: string,
  editedCopy: boolean
): void {
  if (editedCopy) {
    if (!EDITED_COPY_EXTENSIONS.has(extension)) {
      throw new FileValidationError(
        `Unsupported edited output type: .${extension}. Allowed: PDF, JPG, PNG.`
      );
    }
    return;
  }
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new FileValidationError(
      `Unsupported file type: .${extension}. Allowed formats: PDF, JPG, PNG, DOC, DOCX.`
    );
  }
}

/**
 * Magic-byte sniff (first 8 bytes). Mirrors verifyMagicBytes exactly,
 * including which message each mismatch produces.
 */
export function verifyMagicBytes(
  header: Uint8Array,
  extension: string,
  originalFileName: string
): void {
  if (header.length < 4) {
    throw new FileValidationError(
      `Invalid or corrupted file (empty or unreadable): ${originalFileName}`
    );
  }
  const b = (i: number): number => header[i]! & 0xff;
  switch (extension) {
    case "pdf": {
      const ok =
        b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46;
      if (!ok) {
        throw new FileValidationError(
          `Invalid or corrupted PDF file: ${originalFileName}`
        );
      }
      break;
    }
    case "png": {
      const ok =
        b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
      if (!ok) {
        throw new FileValidationError(
          `Invalid or unreadable image file: ${originalFileName}`
        );
      }
      break;
    }
    case "jpg":
    case "jpeg": {
      const ok = b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
      if (!ok) {
        throw new FileValidationError(
          `Invalid or unreadable image file: ${originalFileName}`
        );
      }
      break;
    }
    case "doc": {
      const ok =
        header.length >= 8 &&
        b(0) === 0xd0 && b(1) === 0xcf && b(2) === 0x11 && b(3) === 0xe0 &&
        b(4) === 0xa1 && b(5) === 0xb1 && b(6) === 0x1a && b(7) === 0xe1;
      if (!ok) {
        throw new FileValidationError(
          `Invalid or corrupted DOC file: ${originalFileName}`
        );
      }
      break;
    }
    case "docx": {
      const ok =
        b(0) === 0x50 &&
        b(1) === 0x4b &&
        (b(2) === 0x03 || b(2) === 0x05 || b(2) === 0x07);
      if (!ok) {
        throw new FileValidationError(
          `Invalid or corrupted DOCX file: ${originalFileName}`
        );
      }
      break;
    }
    default:
      break; // unreachable: extension allowlist enforced by caller
  }
}
