import { assertServerRuntime } from "../serverOnly.js";

// Page counting.
// Source: backend/.../service/FileStorageService.calculatePageCount +
// estimatePagesFromText (CHARS_PER_PAGE_ESTIMATE 1800, MAX_PDF_PAGES 2000).
// Rules preserved exactly; only the parsing engines differ (Node runtime):
// - PDF: page count via pdf.js (PDFBox equivalent); 0 pages -> 400;
//   > 2000 pages -> 400 with the legacy message.
// - DOCX: metadata Pages from docProps/app.xml + full-text length
//   estimate, billed max(1, max(meta, estimate)) — same formula.
// - DOC: POI's HWPF SummaryInformation page count has NO Node equivalent;
//   KNOWN DIVERGENCE: DOC counts use max(1, textEstimate) only (metadata
//   treated as 0). Parity harness results are reported separately; files
//   whose metadata exceeds the text estimate will count LOWER than POI.
// - Images: structural validation (PNG IHDR / JPEG SOF) then 1; the
//   ImageIO.read stricter decode check is approximated — malformed-but-
//   header-valid images are the residual risk, reported separately.

export const MAX_PDF_PAGES = 2000;
export const CHARS_PER_PAGE_ESTIMATE = 1800;

export class PageCountError extends Error {
  constructor(
    message: string,
    readonly status: 400 = 400
  ) {
    super(message);
  }
}

export function estimatePagesFromText(text: string | null | undefined): number {
  if (text == null || text.trim().length === 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE_ESTIMATE));
}

export async function countPdfPages(
  data: Uint8Array,
  originalFileName: string
): Promise<number> {
  assertServerRuntime("countPdfPages");
  // pdf.js (same engine family as the admin preview) stands in for PDFBox.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let pages: number;
  try {
    const doc = await (pdfjs as any).getDocument({
      data: new Uint8Array(data),
      isEvalSupported: false,
    }).promise;
    pages = doc.numPages as number;
    // pdf.js v6 removed PDFDocumentProxy.destroy(); release only when
    // the runtime provides it (page count itself never needs cleanup).
    if (typeof doc.destroy === "function") {
      await doc.destroy();
    }
  } catch {
    throw new PageCountError(
      `Invalid or corrupted PDF file: ${originalFileName}`
    );
  }
  if (pages <= 0) {
    throw new PageCountError("Invalid PDF document: page count is zero");
  }
  if (pages > MAX_PDF_PAGES) {
    throw new PageCountError(
      `PDF exceeds the maximum of ${MAX_PDF_PAGES} pages: ${originalFileName}`
    );
  }
  return pages;
}

async function readDocxAppXmlPages(data: Uint8Array): Promise<number> {
  const { default: JSZip } = await import("jszip");
  try {
    const zip = await JSZip.loadAsync(data);
    const appXml = zip.file("docProps/app.xml");
    if (appXml == null) {
      return 0;
    }
    const text = await appXml.async("string");
    const match = text.match(/<(?:\w+:)?Pages>(\d+)<\/(?:\w+:)?Pages>/);
    return match ? Number.parseInt(match[1]!, 10) : 0;
  } catch {
    throw new PageCountError("Invalid or corrupted DOCX file");
  }
}

async function readDocxText(data: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await (mammoth as any).extractRawText({
    buffer: Buffer.from(data),
  });
  return (result.value as string) ?? "";
}

export async function countDocxPages(
  data: Uint8Array,
  originalFileName: string
): Promise<number> {
  assertServerRuntime("countDocxPages");
  try {
    const metadataPages = await readDocxAppXmlPages(data);
    const textEstimate = estimatePagesFromText(await readDocxText(data));
    return Math.max(1, Math.max(metadataPages, textEstimate));
  } catch (err) {
    if (err instanceof PageCountError) {
      if (err.message === "Invalid or corrupted DOCX file") {
        throw new PageCountError(
          `Invalid or corrupted DOCX file: ${originalFileName}`
        );
      }
      throw err;
    }
    throw new PageCountError(
      `Invalid or corrupted DOCX file: ${originalFileName}`
    );
  }
}

export async function countDocPages(
  data: Uint8Array,
  originalFileName: string
): Promise<number> {
  assertServerRuntime("countDocPages");
  // POI parity: metadataPages comes from the \005SummaryInformation OLE
  // stream (PID 14, verified against POI's own reader on POI-written
  // fixtures: 9/0/0 agreement). PROVISIONAL: no positive end-to-end
  // legacy .doc fixture has been verified in isolation (HWPF has no
  // authoring path and customer uploads are prohibited as samples), so
  // DOC support stays as-is without behavior change and without any
  // DOC-to-PDF conversion.
  let metadataPages = 0;
  try {
    metadataPages = await readOleSummaryPageCount(data);
  } catch (err) {
    if (err instanceof PageCountError) {
      throw err;
    }
    throw new PageCountError(
      `Invalid or corrupted DOC file: ${originalFileName}`
    );
  }
  let textEstimate: number;
  try {
    const extractorModule = await import("word-extractor");
    const Extractor = (extractorModule as any).default ?? extractorModule;
    const extractor = new Extractor();
    const doc = await extractor.extract(Buffer.from(data));
    textEstimate = estimatePagesFromText(doc.getBody() as string);
  } catch {
    throw new PageCountError(
      `Invalid or corrupted DOC file: ${originalFileName}`
    );
  }
  return Math.max(1, Math.max(metadataPages, textEstimate));
}

// \005SummaryInformation stream name + section FMTID, both byte-verified
// against POI (PropertySet.init layout + SummaryInformation.getPageCount
// reading PID 14 as VT_I4).
const OLE_SUMMARY_STREAM = String.fromCharCode(5) + "SummaryInformation";
const SUMMARY_FMTID = Buffer.from(
  "e0859ff2f94f6810ab9108002b27b3d9",
  "hex"
);
const PID_PAGECOUNT = 14;

function readU16(buf: Buffer, off: number): number {
  if (off + 2 > buf.length) {
    throw new Error("truncated");
  }
  return buf.readUInt16LE(off);
}

function readU32(buf: Buffer, off: number): number {
  if (off + 4 > buf.length) {
    throw new Error("truncated");
  }
  return buf.readUInt32LE(off);
}

function readI32(buf: Buffer, off: number): number {
  if (off + 4 > buf.length) {
    throw new Error("truncated");
  }
  return buf.readInt32LE(off);
}

/**
 * Parses a raw MS-OSHARED property set and returns PID 14 (VT_I2/I4/UI4)
 * from the SummaryInformation section, or 0 when absent. Throws on
 * malformed data (mirrors POI throwing on corrupt property sets).
 * Exported for unit tests (fixtures validated against POI itself).
 */
export function parseSummaryPageCount(raw: Uint8Array): number {
  const buf = Buffer.from(raw);
  if (buf.length < 28 || readU16(buf, 0) !== 0xfffe) {
    throw new Error("not a property set");
  }
  const numSections = readU32(buf, 24);
  for (let i = 0; i < numSections; i++) {
    const entryOff = 28 + i * 20;
    if (entryOff + 20 > buf.length) {
      throw new Error("truncated section table");
    }
    if (!buf.subarray(entryOff, entryOff + 16).equals(SUMMARY_FMTID)) {
      continue;
    }
    const secOff = readU32(buf, entryOff + 16);
    if (secOff + 8 > buf.length) {
      throw new Error("truncated section");
    }
    const count = readU32(buf, secOff + 4);
    for (let p = 0; p < count; p++) {
      const rowOff = secOff + 8 + p * 8;
      if (rowOff + 8 > buf.length) {
        throw new Error("truncated property table");
      }
      if (readU32(buf, rowOff) !== PID_PAGECOUNT) {
        continue;
      }
      const valOff = secOff + readU32(buf, rowOff + 4);
      const vt = readU16(buf, valOff);
      if (vt === 3) {
        return readI32(buf, valOff + 4);
      }
      if (vt === 2) {
        if (valOff + 6 > buf.length) {
          throw new Error("truncated value");
        }
        return buf.readInt16LE(valOff + 4);
      }
      if (vt === 19) {
        return readU32(buf, valOff + 4);
      }
      throw new Error(`unsupported page-count variant ${vt}`);
    }
    return 0;
  }
  return 0;
}

async function collectStream(stream: any): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on("data", (d: Buffer) => parts.push(d));
    stream.on("end", () => resolve(Buffer.concat(parts)));
    stream.on("error", (e: Error) => reject(e));
  });
}

/**
 * Reads PID 14 from the \005SummaryInformation OLE stream:
 * absent stream -> 0 (POI null-summary path); corrupt stream/OLE ->
 * throws (POI throws too). Uses word-extractor's own (proven) OLE
 * reader, pinned to word-extractor@1.0.4.
 */
export async function readOleSummaryPageCount(
  data: Uint8Array
): Promise<number> {
  assertServerRuntime("readOleSummaryPageCount");
  // NOTE: explicit .js extensions — Node ESM resolution (vitest, Next)
  // requires them for deep CJS subpaths; plain require() tolerates both.
  const bufferReaderMod: any = await import(
    "word-extractor/lib/buffer-reader.js"
  );
  const oleMod: any = await import("word-extractor/lib/ole-compound-doc.js");
  const BufferReader = bufferReaderMod.default ?? bufferReaderMod;
  const OleCompoundDoc = oleMod.default ?? oleMod;
  const doc = new OleCompoundDoc(
    new BufferReader(Buffer.from(data))
  );
  try {
    await doc.read();
  } catch {
    // OLE-level failure: metadata unknown. Text extraction (which parses
    // the same structures, like the HWPF constructor) decides the file's
    // fate; a broken FAT fails there too -> legacy 400 either way.
    return 0;
  }
  let stream: any;
  try {
    stream = doc.stream(OLE_SUMMARY_STREAM);
  } catch {
    return 0;
  }
  if (stream == null) {
    return 0;
  }
  const bytes = await collectStream(stream);
  return parseSummaryPageCount(new Uint8Array(bytes));
}

function validateImageStructure(
  data: Uint8Array,
  extension: string,
  originalFileName: string
): void {
  if (extension === "png") {
    // PNG signature (magic-checked) + IHDR chunk header must be present.
    const ihdr =
      data.length >= 24 &&
      data[12] === 0x49 && data[13] === 0x48 &&
      data[14] === 0x44 && data[15] === 0x52;
    if (!ihdr) {
      throw new PageCountError(
        `Invalid or unreadable image file: ${originalFileName}`
      );
    }
    return;
  }
  // JPEG: SOI (magic-checked) plus at least one Start-Of-Frame marker.
  let foundSof = false;
  for (let i = 2; i + 1 < data.length; i++) {
    if (data[i] === 0xff && data[i + 1] !== 0x00 && data[i + 1] !== 0xff) {
      const marker = data[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        foundSof = true;
        break;
      }
      if (marker === 0xd9) {
        break;
      }
    }
  }
  if (!foundSof) {
    throw new PageCountError(
      `Invalid or unreadable image file: ${originalFileName}`
    );
  }
}

export async function countImagePages(
  data: Uint8Array,
  extension: string,
  originalFileName: string
): Promise<number> {
  assertServerRuntime("countImagePages");
  validateImageStructure(data, extension, originalFileName);
  return 1;
}

export async function calculatePageCount(
  data: Uint8Array,
  extension: string,
  originalFileName: string
): Promise<number> {
  assertServerRuntime("calculatePageCount");
  if (extension === "pdf") {
    return countPdfPages(data, originalFileName);
  }
  if (extension === "docx") {
    return countDocxPages(data, originalFileName);
  }
  if (extension === "doc") {
    return countDocPages(data, originalFileName);
  }
  if (extension === "jpg" || extension === "jpeg" || extension === "png") {
    return countImagePages(data, extension, originalFileName);
  }
  return 1;
}
