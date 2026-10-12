import { assertServerRuntime } from "./serverOnly.js";

// Pricing engine.
// Source: backend/.../service/PricingEngineService.java (calculatePrice,
// getRatePerPage, parsePageRange) + PublicPricingController +
// PricingCalculateRequest (@NotNull/@Min messages) +
// PricingCalculateResponse (field names).
//
// Exact rules preserved:
// - Document/pricing absence -> 400 "Document not found" /
//   "Shop pricing configuration not found" (IllegalArgument).
// - copies clamped to [1,100] server-side (L-03); @Min(1) rejects < 1.
// - PASSPORT_PHOTO bypasses the matrix and charges passportPrice per unit.
// - DOUBLE sides charge ceil(pages/2) sheets; breakdown unit label and
//   spec description follow the same branch (no type special-casing).
// - Money is integer paise internally (rates have scale <= 2), so totals
//   match BigDecimal exactness; overflow beyond safe integers maps to the
//   generic 500 like Math.multiplyExact's ArithmeticException.
// - parsePageRange transcribed branch-for-branch: null/blank/ALL -> total;
//   comma parts, reversed ranges normalized, per-page clamp [1,total],
//   dedup, empty set -> total, ANY parse failure -> total.
// - Unknown enum strings -> 400 "Malformed request body" (Jackson
//   InvalidFormatException is an HttpMessageNotReadableException).
//
// Approximation (documented): @Valid multi-violation message order is
// HashMap-undefined upstream; single-violation messages match exactly.

export type PrintTypeValue = "PRINT" | "XEROX" | "PASSPORT_PHOTO";
export type ColorModeValue = "BW" | "COLOR";
export type PaperSizeValue = "A4" | "A3";
export type PrintSideValue = "SINGLE" | "DOUBLE";

const PRINT_TYPES: ReadonlySet<string> = new Set([
  "PRINT",
  "XEROX",
  "PASSPORT_PHOTO",
]);
const COLOR_MODES: ReadonlySet<string> = new Set(["BW", "COLOR"]);
const PAPER_SIZES: ReadonlySet<string> = new Set(["A4", "A3"]);
const PRINT_SIDES: ReadonlySet<string> = new Set(["SINGLE", "DOUBLE"]);

export interface ShopPricingRow {
  bwA4Single: string;
  bwA4Double: string;
  colorA4Single: string;
  colorA4Double: string;
  bwA3Single: string;
  bwA3Double: string;
  colorA3Single: string;
  colorA3Double: string;
  passportPrice: string;
}

export interface PricingDocumentRow {
  pageCount: number;
}

export interface PricingStore {
  findDocumentById(documentId: string): Promise<PricingDocumentRow | null>;
  findPricingByShopId(shopId: string): Promise<ShopPricingRow | null>;
}

export interface PricingInput {
  shopId: unknown;
  documentId: unknown;
  printType: unknown;
  colorMode: unknown;
  paperSize: unknown;
  printSide: unknown;
  pageRange?: unknown;
  copies?: unknown;
}

export interface PricingResult {
  totalDocumentPages: number;
  calculatedPages: number;
  copies: number;
  unitPricePerPage: number;
  totalPrice: number;
  breakdown: string;
}

export class PricingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 500 = 400
  ) {
    super(message);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, missingMessage: string): string {
  // Jackson fails UUID deserialization -> HttpMessageNotReadable (400
  // "Malformed request body"); absent -> @NotNull message.
  if (value == null || (typeof value === "string" && value.length === 0)) {
    throw new PricingError(missingMessage, 400);
  }
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PricingError("Malformed request body", 400);
  }
  return value;
}

function requireEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  missingMessage: string
): string {
  if (value == null || (typeof value === "string" && value.length === 0)) {
    throw new PricingError(missingMessage, 400);
  }
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new PricingError("Malformed request body", 400);
  }
  return value;
}

function requireCopies(value: unknown): number {
  // Absent -> field default 1; explicit null hits primitive-int 0 upstream
  // (@Min violation). Non-integers fail Jackson int coercion (malformed).
  if (value === undefined) {
    return 1;
  }
  const n = value === null ? 0 : value;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new PricingError("Malformed request body", 400);
  }
  if (n < 1) {
    throw new PricingError("Copies must be at least 1", 400);
  }
  return n;
}

function coercePageRange(value: unknown): string {
  // Field default "ALL"; Jackson coerces JSON numbers to String.
  if (value == null) {
    return "ALL";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "ALL";
}

/** Strict Java Integer.parseInt semantics (no trailing garbage). */
function strictParseInt(text: string): number {
  if (!/^[+-]?\d+$/.test(text)) {
    throw new Error(`not an integer: ${text}`);
  }
  return Number.parseInt(text, 10);
}

export function parsePageRange(pageRange: string | null, totalPages: number): number {
  assertServerRuntime("parsePageRange");
  if (
    pageRange == null ||
    pageRange.trim().length === 0 ||
    pageRange.trim().toUpperCase() === "ALL"
  ) {
    return totalPages;
  }
  try {
    const unique = new Set<number>();
    for (const rawPart of pageRange.split(",")) {
      const part = rawPart.trim();
      if (part.includes("-")) {
        const range = part.split("-");
        if (range.length === 2) {
          const start = strictParseInt(range[0]!.trim());
          const end = strictParseInt(range[1]!.trim());
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          for (let i = min; i <= max; i++) {
            if (i >= 1 && i <= totalPages) {
              unique.add(i);
            }
          }
        }
      } else if (part.length > 0) {
        const p = strictParseInt(part);
        if (p >= 1 && p <= totalPages) {
          unique.add(p);
        }
      }
    }
    return unique.size === 0 ? totalPages : unique.size;
  } catch {
    return totalPages;
  }
}

/** Exact decimal string (scale <= 2) -> integer paise. */
export function decimalToPaise(decimal: string): number {
  const neg = decimal.trim().startsWith("-");
  const abs = neg ? decimal.trim().slice(1) : decimal.trim();
  const [ints = "0", fracRaw = ""] = abs.split(".");
  const frac = (fracRaw + "00").slice(0, 2);
  const paise = Number.parseInt(ints, 10) * 100 + Number.parseInt(frac, 10);
  return neg ? -paise : paise;
}

/** Integer paise -> "7.50" style plain string (BigDecimal.toPlainString). */
export function paiseToDecimal(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${text}` : text;
}

function rateFor(
  pricing: ShopPricingRow,
  printType: string,
  colorMode: string,
  paperSize: string,
  printSide: string
): number {
  if (printType === "PASSPORT_PHOTO") {
    return decimalToPaise(pricing.passportPrice);
  }
  const key =
    (paperSize === "A4" ? (colorMode === "BW" ? "bwA4" : "colorA4") : colorMode === "BW" ? "bwA3" : "colorA3") +
    (printSide === "SINGLE" ? "Single" : "Double");
  const rate: Record<string, string> = {
    bwA4Single: pricing.bwA4Single,
    bwA4Double: pricing.bwA4Double,
    colorA4Single: pricing.colorA4Single,
    colorA4Double: pricing.colorA4Double,
    bwA3Single: pricing.bwA3Single,
    bwA3Double: pricing.bwA3Double,
    colorA3Single: pricing.colorA3Single,
    colorA3Double: pricing.colorA3Double,
  };
  return decimalToPaise(rate[key]!);
}

export async function calculatePrice(
  store: PricingStore,
  input: PricingInput
): Promise<PricingResult> {
  assertServerRuntime("calculatePrice");
  const shopId = requireUuid(input.shopId, "Shop ID is required");
  const documentId = requireUuid(input.documentId, "Document ID is required");
  const printType = requireEnum(input.printType, PRINT_TYPES, "Print type is required");
  const colorMode = requireEnum(input.colorMode, COLOR_MODES, "Color mode is required");
  const paperSize = requireEnum(input.paperSize, PAPER_SIZES, "Paper size is required");
  const printSide = requireEnum(input.printSide, PRINT_SIDES, "Print side is required");
  const pageRange = coercePageRange(input.pageRange);
  const requestedCopies = requireCopies(input.copies);

  const document = await store.findDocumentById(documentId);
  if (document == null) {
    throw new PricingError("Document not found", 400);
  }
  const pricing = await store.findPricingByShopId(shopId);
  if (pricing == null) {
    throw new PricingError("Shop pricing configuration not found", 400);
  }

  const totalDocumentPages = document.pageCount;
  const pagesToPrint = parsePageRange(pageRange, totalDocumentPages);
  const copies = Math.max(1, Math.min(requestedCopies, 100));
  const ratePaise = rateFor(pricing, printType, colorMode, paperSize, printSide);
  const unitsToCharge =
    printSide === "DOUBLE" ? Math.ceil(pagesToPrint / 2) : pagesToPrint;
  const totalUnits = unitsToCharge * copies;
  if (!Number.isSafeInteger(totalUnits) || !Number.isSafeInteger(ratePaise * totalUnits)) {
    throw new PricingError("An internal server error occurred", 500);
  }
  const totalPaise = ratePaise * totalUnits;

  const specDesc = `${colorMode === "BW" ? "B&W" : "Color"} • ${paperSize} • ${
    printSide === "SINGLE" ? "Single Side" : "Double Side"
  } • ${printType}`;
  const unitLabel = printSide === "DOUBLE" ? "Sheets" : "Pages";
  const breakdown =
    `${unitsToCharge} ${unitLabel} × ₹${paiseToDecimal(ratePaise)} × ` +
    `${copies} Copies = ₹${paiseToDecimal(totalPaise)} (${specDesc})`;

  return {
    totalDocumentPages,
    calculatedPages: pagesToPrint,
    copies,
    unitPricePerPage: Number(paiseToDecimal(ratePaise)),
    totalPrice: Number(paiseToDecimal(totalPaise)),
    breakdown,
  };
}
