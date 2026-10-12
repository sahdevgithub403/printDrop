import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  EDITED_COPY_EXTENSIONS,
  assertAllowedExtension,
  assertSafeDisplayName,
  getFileExtension,
  verifyMagicBytes,
  FileValidationError,
} from "./magic.js";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]);
const DOC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);
const TEXT = new TextEncoder().encode("plain text!!");

describe("file validation (FileStorageService)", () => {
  it("keeps the exact extension allowlists", () => {
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual([
      "doc",
      "docx",
      "jpeg",
      "jpg",
      "pdf",
      "png",
    ]);
    expect([...EDITED_COPY_EXTENSIONS].sort()).toEqual([
      "jpeg",
      "jpg",
      "pdf",
      "png",
    ]);
    expect(() =>
      assertAllowedExtension("exe", false)
    ).toThrowError(
      "Unsupported file type: .exe. Allowed formats: PDF, JPG, PNG, DOC, DOCX."
    );
    expect(() => assertAllowedExtension("docx", true)).toThrowError(
      "Unsupported edited output type: .docx. Allowed: PDF, JPG, PNG."
    );
  });

  it("accepts exact magic bytes per type", () => {
    expect(() => verifyMagicBytes(PDF, "pdf", "a.pdf")).not.toThrow();
    expect(() => verifyMagicBytes(PNG, "png", "a.png")).not.toThrow();
    expect(() => verifyMagicBytes(JPG, "jpg", "a.jpg")).not.toThrow();
    expect(() => verifyMagicBytes(JPG, "jpeg", "a.jpeg")).not.toThrow();
    expect(() => verifyMagicBytes(DOC, "doc", "a.doc")).not.toThrow();
    expect(() => verifyMagicBytes(DOCX, "docx", "a.docx")).not.toThrow();
  });

  it("rejects mismatched magic with the legacy per-type messages", () => {
    const cases: Array<[Uint8Array, string, string]> = [
      [TEXT, "pdf", "Invalid or corrupted PDF file: a.pdf"],
      [TEXT, "png", "Invalid or unreadable image file: a.png"],
      [TEXT, "jpg", "Invalid or unreadable image file: a.jpg"],
      [TEXT, "doc", "Invalid or corrupted DOC file: a.doc"],
      [TEXT, "docx", "Invalid or corrupted DOCX file: a.docx"],
      [new Uint8Array([1, 2]), "pdf", "Invalid or corrupted file (empty or unreadable): a.pdf"],
    ];
    for (const [header, ext, message] of cases) {
      try {
        verifyMagicBytes(header, ext, ext === "pdf" && header.length < 4 ? "a.pdf" : `a.${ext}`);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(FileValidationError);
        expect((err as Error).message).toBe(message);
      }
    }
  });

  it("guards traversal names and parses extensions like getFileExtension", () => {
    expect(() => assertSafeDisplayName("../x.pdf", "upload")).toThrowError(
      /invalid path sequence/
    );
    expect(() => assertSafeDisplayName("  ", "generated")).toThrowError(
      "Invalid generated file name"
    );
    expect(getFileExtension("a.PDF")).toBe("PDF");
    expect(getFileExtension("noext")).toBe("");
    expect(getFileExtension(null)).toBe("");
  });
});
