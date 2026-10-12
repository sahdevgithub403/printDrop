import { describe, expect, it } from "vitest";
import {
  buildAttachmentHeader,
  fallbackContentType,
  deleteStoredDocument,
  storeUpload,
  storeEditedCopy,
  OVERSIZE_MESSAGE,
  type DocumentDb,
} from "./service.js";
import {
  LocalDirectoryAdapter,
  R2Adapter,
  readR2Config,
  DOWNLOAD_TTL_SECONDS,
  assertSafeKey,
  type StorageAdapter,
} from "./storage.js";

function memoryStorage(): StorageAdapter & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    backend: "memory-test",
    objects,
    async put(key: string, data: Uint8Array) {
      objects.set(key, new Uint8Array(data));
    },
    async get(key: string) {
      return objects.get(key) ?? null;
    },
    async remove(key: string) {
      return objects.delete(key) || true;
    },
    async presignedGet() {
      throw new Error("no presign in memory adapter");
    },
  };
}

function memoryDb(): DocumentDb & {
  rows: Map<string, any>;
  calls: string[];
} {
  const rows = new Map<string, any>();
  const calls: string[] = [];
  let seq = 0;
  return {
    rows,
    calls,
    async insertDocument(input: any) {
      calls.push("insert");
      const row = { id: `doc-${++seq}`, ...input, parentDocumentId: null };
      rows.set(row.id, row);
      return row;
    },
    async setParentDocumentId(id: string, parent: string) {
      calls.push("lineage");
      const row = rows.get(id);
      row.parentDocumentId = parent;
      return row;
    },
    async findDocumentById(id: string) {
      return rows.get(id) ?? null;
    },
    async nullifyDocumentReferences() {
      calls.push("nullify");
    },
    async deleteDocumentRow(id: string) {
      calls.push("delete-row");
      rows.delete(id);
    },
  };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 37]);

describe("upload service (FileStorageService orchestration)", () => {
  it("stores valid uploads and records exact metadata", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([595, 842]);
      page.drawText(`p${i}`, { x: 50, y: 800, font, size: 12 });
    }
    const bytes = await doc.save();
    const storage = memoryStorage();
    const db = memoryDb();
    const { row } = await storeUpload(
      storage,
      db,
      {
        originalFileName: "Report.PDF",
        contentType: "application/pdf",
        data: bytes,
      },
      "shop-1",
      { editedCopy: false }
    );
    expect(row.originalFileName).toBe("Report.PDF");
    expect(row.contentType).toBe("application/pdf");
    expect(row.fileSize).toBe(bytes.length);
    expect(row.pageCount).toBe(2);
    expect(row.shopId).toBe("shop-1");
    expect(row.storedFileName).toMatch(
      /^[0-9a-f-]{36}\.pdf$/
    );
    expect(storage.objects.has(row.storedFileName)).toBe(true);
  });

  it("rejects oversize payloads with the legacy message", async () => {
    const storage = memoryStorage();
    const db = memoryDb();
    try {
      await storeUpload(
        storage,
        db,
        {
          originalFileName: "big.pdf",
          contentType: "application/pdf",
          data: new Uint8Array(21 * 1024 * 1024),
        },
        null,
        { editedCopy: false }
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe(OVERSIZE_MESSAGE);
    }
    expect(storage.objects.size).toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("cleans staged state when the row insert fails", async () => {
    const storage = memoryStorage();
    const db = memoryDb();
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8,
    ]);
    db.insertDocument = async () => {
      throw new Error("db down");
    };
    try {
      await storeUpload(
        storage,
        db,
        { originalFileName: "a.png", contentType: "image/png", data: png },
        null,
        { editedCopy: false }
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe("db down");
    }
    expect(storage.objects.size).toBe(0);
  });

  it("gates edited copies on source access and links lineage", async () => {
    const storage = memoryStorage();
    const db = memoryDb();
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8,
    ]);
    try {
      await storeEditedCopy(
        storage,
        db,
        { originalFileName: "e.png", contentType: "image/png", data: png },
        "shop-a",
        "foreign-doc",
        async () => false
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe(
        "Source document does not belong to your shop or does not exist"
      );
      expect((err as any).status).toBe(403);
    }
    try {
      await storeEditedCopy(
        storage,
        db,
        { originalFileName: "e.png", contentType: "image/png", data: new Uint8Array(0) },
        "shop-a",
        null,
        async () => true
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe("Edited file is missing");
    }
    const { row } = await storeEditedCopy(
      storage,
      db,
      { originalFileName: "e.png", contentType: "image/png", data: png },
      "shop-a",
      "source-1",
      async () => true
    );
    expect(row.parentDocumentId).toBe("source-1");
    expect(row.shopId).toBe("shop-a");
    expect(db.calls).toEqual(["insert", "lineage"]);
  });

  it("deletes object-first and fails loudly when storage fails", async () => {
    const storage = memoryStorage();
    const db = memoryDb();
    await expect(
      deleteStoredDocument(
        { ...storage, remove: async () => false },
        db,
        "k.pdf",
        "doc-9"
      )
    ).rejects.toMatchObject({ status: 500 });
    expect(db.calls).toEqual([]);

    storage.objects.set("k.pdf", new Uint8Array([1]));
    await deleteStoredDocument(storage, db, "k.pdf", "doc-9");
    expect(db.calls).toEqual(["nullify", "delete-row"]);
    expect(storage.objects.size).toBe(0);
  });

  it("builds the exact legacy attachment header", () => {
    expect(buildAttachmentHeader("report final.pdf")).toBe(
      'attachment; filename="report final.pdf"; filename*=UTF-8\'\'report%20final.pdf'
    );
    expect(buildAttachmentHeader("evil\r\n\"x.pdf")).toBe(
      'attachment; filename="evil___x.pdf"; filename*=UTF-8\'\'evil___x.pdf'
    );
    expect(buildAttachmentHeader(null)).toBe(
      'attachment; filename="document"; filename*=UTF-8\'\'document'
    );
    expect(fallbackContentType(null)).toBe("application/octet-stream");
    expect(fallbackContentType("")).toBe("application/octet-stream");
    expect(fallbackContentType("image/png")).toBe("image/png");
  });
});

describe("storage adapters", () => {
  it("keeps downloads at the approved 5-minute TTL and guards keys", () => {
    expect(DOWNLOAD_TTL_SECONDS).toBe(300);
    expect(() => assertSafeKey("../x")).toThrow();
    expect(() => assertSafeKey("a/b")).toThrow();
    expect(() => assertSafeKey("")).toThrow();
    expect(() => assertSafeKey("ok-uuid.pdf")).not.toThrow();
  });

  it("refuses R2 without configuration (never connects blindly)", () => {
    expect(readR2Config({} as NodeJS.ProcessEnv)).toBeNull();
    expect(() => new R2Adapter(null)).toThrowError(/missing R2 configuration/);
  });

  it("exercises local-directory semantics (test/dev only)", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "printdrop-storage-test-"));
    const adapter = new LocalDirectoryAdapter(dir);
    expect(adapter.backend).toBe("local-directory");
    await adapter.put("a.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    expect(await adapter.get("a.pdf")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await adapter.get("missing.pdf")).toBeNull();
    expect(await adapter.remove("missing.pdf")).toBe(true);
    expect(await adapter.remove("a.pdf")).toBe(true);
    await expect(adapter.presignedGet("a.pdf", "x")).rejects.toThrow();
    await expect(adapter.put("../evil", new Uint8Array([1]), "x")).rejects.toThrow();
  });
});
