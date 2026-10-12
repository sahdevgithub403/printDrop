import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
import {
  calculatePageCount,
  estimatePagesFromText,
  parseSummaryPageCount,
  readOleSummaryPageCount,
  MAX_PDF_PAGES,
} from "./pageCount.js";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`page ${i + 1}`, { x: 50, y: 800, font, size: 12 });
  }
  return doc.save();
}

async function makeDocx(opts: {
  text: string;
  pagesMeta: number | null;
}): Promise<Uint8Array> {
  const contentTypes =
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const rels =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  const esc = opts.text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const document =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body><w:p><w:r><w:t>${esc}</w:t></w:r></w:p></w:body></w:document>`;
  const appProps =
    '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    (opts.pagesMeta == null ? "" : `<Pages>${opts.pagesMeta}</Pages>`) +
    "</Properties>";
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", document);
  zip.file("docProps/app.xml", appProps);
  return zip.generateAsync({ type: "uint8array" });
}

function makePng(valid: boolean): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!valid) {
    return new Uint8Array(sig);
  }
  return new Uint8Array([
    ...sig, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 8, 0, 0, 0, 8, 1, 2, 3, 4, 5, 6, 7, 8,
  ]);
}

function makeJpeg(valid: boolean): Uint8Array {
  const soi = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3];
  if (!valid) {
    return new Uint8Array(soi);
  }
  return new Uint8Array([
    ...soi, 0xff, 0xc0, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0, 0xff, 0xd9,
  ]);
}

describe("page counting (FileStorageService.calculatePageCount)", () => {
  it("keeps the PDF and text-estimate constants", () => {
    expect(MAX_PDF_PAGES).toBe(2000);
    expect(estimatePagesFromText("")).toBe(1);
    expect(estimatePagesFromText("x".repeat(1800))).toBe(1);
    expect(estimatePagesFromText("x".repeat(1801))).toBe(2);
  });

  it(
    "counts PDF pages and enforces the 2000-page cap",
    async () => {
    expect(await calculatePageCount(await makePdf(3), "pdf", "a.pdf")).toBe(3);
    try {
      await calculatePageCount(await makePdf(2001), "pdf", "big.pdf");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe(
        "PDF exceeds the maximum of 2000 pages: big.pdf"
      );
    }
    try {
      await calculatePageCount(
        new TextEncoder().encode("not a pdf"),
        "pdf",
        "fake.pdf"
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe(
        "Invalid or corrupted PDF file: fake.pdf"
      );
    }
  },
  120_000
  );

  it("applies the DOCX metadata-vs-text rule identically to POI", async () => {
    // metadata wins
    expect(
      await calculatePageCount(
        await makeDocx({ text: "short", pagesMeta: 7 }),
        "docx",
        "a.docx"
      )
    ).toBe(7);
    // text estimate wins (3700 chars -> 3 pages; margin keeps mammoth's
    // trailing newline from flipping the ceiling)
    expect(
      await calculatePageCount(
        await makeDocx({ text: "y".repeat(3700), pagesMeta: 2 }),
        "docx",
        "b.docx"
      )
    ).toBe(3);
    // no metadata -> text estimate, minimum 1
    expect(
      await calculatePageCount(
        await makeDocx({ text: "short", pagesMeta: null }),
        "docx",
        "c.docx"
      )
    ).toBe(1);
  });

  it("rejects malformed DOC files like POI", async () => {
    try {
      await calculatePageCount(
        new TextEncoder().encode("not ole content!!"),
        "doc",
        "a.doc"
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe(
        "Invalid or corrupted DOC file: a.doc"
      );
    }
  });

describe("OLE summary metadata (HWPF SummaryInformation parity)", () => {
  // POI-written OLE filesystem (POI itself reads PAGES 9 from it).
  // Embedded to keep the suite self-contained; source fixture generated
  // by parity/mkprops.cjs + POIFS writer (temp, uncommitted).
  const PROP9_OLE_B64 = "0M8R4KGxGuEAAAAAAAAAAAAAAAAAAAAAOwADAP7/CQAGAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAEAAAAgAAAAEAAAD+////AAAAAAEAAAD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9SAG8AbwB0ACAARQBuAHQAcgB5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFgAFAf//////////AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAACAAAAAAAAAAAUAUwB1AG0AbQBhAHIAeQBJAG4AZgBvAHIAbQBhAHQAaQBvAG4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoAAIB////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7////9/////v////7/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AQAAAP7////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAA4IWf8vlPaBCrkQgAKyez2TAAAAAYAAAAAQAAAA4AAAAQAAAAAwAAAAkAAAD//////////////////////////////////////////////////////////////////////////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
  // Raw property-set builder mirroring parity/mkprops.cjs. The same byte
  // layouts were validated against POI itself (POI_PAGES 9/0/0).
  const FMTID = Buffer.from("e0859ff2f94f6810ab9108002b27b3d9", "hex");
  function propertySet(entries: Array<{ pid: number; vt: number; int32: number }>): Uint8Array {
    const head = Buffer.alloc(28);
    head.writeUInt16LE(0xfffe, 0);
    head.writeUInt32LE(1, 24);
    const off = Buffer.alloc(4);
    off.writeUInt32LE(48, 0);
    let table = Buffer.alloc(0);
    let values = Buffer.alloc(0);
    let cursor = 16;
    for (const e of entries) {
      const row = Buffer.alloc(8);
      row.writeUInt32LE(e.pid, 0);
      row.writeUInt32LE(cursor, 4);
      table = Buffer.concat([table, row]);
      const val = Buffer.alloc(8);
      val.writeUInt16LE(e.vt, 0);
      val.writeInt32LE(e.int32, 4);
      values = Buffer.concat([values, val]);
      cursor += 8;
    }
    const secHead = Buffer.alloc(8);
    secHead.writeUInt32LE(8 + table.length + values.length, 0);
    secHead.writeUInt32LE(entries.length, 4);
    return new Uint8Array(Buffer.concat([head, FMTID, off, secHead, table, values]));
  }

  it("reads PID 14 like POI's getPageCount()", () => {
    expect(parseSummaryPageCount(propertySet([{ pid: 14, vt: 3, int32: 9 }]))).toBe(9);
    expect(parseSummaryPageCount(propertySet([{ pid: 14, vt: 2, int32: 4 }]))).toBe(4);
    expect(parseSummaryPageCount(propertySet([{ pid: 14, vt: 19, int32: 6 }]))).toBe(6);
  });

  it("returns 0 for absent PID or empty sets (POI default)", () => {
    const head = Buffer.alloc(28);
    head.writeUInt16LE(0xfffe, 0);
    head.writeUInt32LE(1, 24);
    const off = Buffer.alloc(4);
    off.writeUInt32LE(48, 0);
    const secHead = Buffer.alloc(8);
    secHead.writeUInt32LE(8, 0);
    secHead.writeUInt32LE(0, 4);
    expect(
      parseSummaryPageCount(new Uint8Array(Buffer.concat([head, FMTID, off, secHead])))
    ).toBe(0);
    expect(
      parseSummaryPageCount(propertySet([{ pid: 7, vt: 3, int32: 12 }]))
    ).toBe(0);
  });

  it("throws on malformed property sets (POI throws too)", () => {
    expect(() => parseSummaryPageCount(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() =>
      parseSummaryPageCount(propertySet([{ pid: 14, vt: 30, int32: 1 }]))
    ).toThrow();
  });

  it("extracts PID 14 end-to-end from a POI-written OLE filesystem", async () => {
    // prop9.ole: POI POIFS writer output, POI itself reads PAGES 9.
    const ole = Buffer.from(PROP9_OLE_B64, "base64");
    expect(await readOleSummaryPageCount(new Uint8Array(ole))).toBe(9);
  });

  it("treats non-OLE input as unknown metadata (text gate decides)", async () => {
    expect(
      await readOleSummaryPageCount(new TextEncoder().encode("not ole at all............................"))
    ).toBe(0);
  });
});

describe("image structure validation", () => {
  it("validates image structure then counts 1", async () => {    expect(await calculatePageCount(makePng(true), "png", "a.png")).toBe(1);
    expect(await calculatePageCount(makeJpeg(true), "jpg", "a.jpg")).toBe(1);
    for (const [data, ext, name] of [
      [makePng(false), "png", "bad.png"],
      [makeJpeg(false), "jpg", "bad.jpg"],
    ] as Array<[Uint8Array, string, string]>) {
      try {
        await calculatePageCount(data, ext, name);
        expect.unreachable();
      } catch (err) {
        expect((err as Error).message).toBe(
          `Invalid or unreadable image file: ${name}`
        );
      }
    }
  });
});
});
