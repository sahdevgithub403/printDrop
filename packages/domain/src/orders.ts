import { randomInt, randomUUID } from "node:crypto";
import { assertServerRuntime } from "./serverOnly.js";
import {
  calculatePrice,
  decimalToPaise,
  paiseToDecimal,
  type PricingStore,
} from "./pricing.js";
import { publishEvent, readRealtimeConfig, type OrderEvent } from "./events.js";

// Order lifecycle. Sources: backend/.../service/OrderService.java (full
// transcription incl. transition maps, PAID gates, legacy mirrors,
// order-number scheme, WS event names) + PublicOrderController +
// AdminOrderController messages. Money moves as integer paise; writes use
// exact 2dp strings (BigDecimal parity). Prisma Decimal reads arrive as
// strings via the adapter (see apps/customer/lib/orderStore.ts).

export const MAX_COPIES_PER_ITEM = 100;
const ORDER_NUMBER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ORDER_NUMBER_LENGTH = 6;

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 500 | 503 = 400
  ) {
    super(message);
  }
}

export const PRINT_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PRINTING", "COMPLETED", "FAILED", "CANCELLED"],
  PRINTING: ["PRINTING", "COMPLETED", "FAILED", "CANCELLED"],
  FAILED: ["PRINTING", "PENDING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const PAYMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PAID", "FAILED"],
  FAILED: ["PAID", "PENDING"],
  PAID: ["REFUNDED"],
  REFUNDED: [],
};

const PRINT_STATUSES = new Set(Object.keys(PRINT_STATUS_TRANSITIONS));
const PAYMENT_STATUSES = new Set(Object.keys(PAYMENT_STATUS_TRANSITIONS));
const PAYMENT_METHODS = new Set(["ONLINE", "PAY_AT_SHOP"]);

function requireAllowedPrintTransition(from: string | null, to: string | null): void {
  if (from == null || to == null) {
    throw new OrderError("Print status must be specified", 400);
  }
  if (from === to) {
    return;
  }
  if (!(PRINT_STATUS_TRANSITIONS[from] ?? []).includes(to)) {
    throw new OrderError(
      `Invalid print status transition from ${from} to ${to}`,
      400
    );
  }
}

function requireAllowedPaymentTransition(from: string | null, to: string | null): void {
  if (from == null || to == null) {
    throw new OrderError("Payment status must be specified", 400);
  }
  if (from === to) {
    return;
  }
  if (!(PAYMENT_STATUS_TRANSITIONS[from] ?? []).includes(to)) {
    throw new OrderError(
      `Invalid payment status transition from ${from} to ${to}`,
      400
    );
  }
}

function paidGate(paymentMethod: string, paymentStatus: string, target: string): void {
  if (
    paymentMethod === "ONLINE" &&
    paymentStatus !== "PAID" &&
    (target === "PRINTING" || target === "COMPLETED")
  ) {
    throw new OrderError(
      "Online payment must be PAID before printing or completing",
      400
    );
  }
}

export function deriveOrderStatus(itemStatuses: string[]): string {
  if (itemStatuses.length === 0) {
    return "PENDING";
  }
  if (itemStatuses.every((s) => s === "COMPLETED")) {
    return "COMPLETED";
  }
  if (itemStatuses.every((s) => s === "CANCELLED")) {
    return "CANCELLED";
  }
  if (itemStatuses.every((s) => s === "PENDING")) {
    return "PENDING";
  }
  const anyPrinting = itemStatuses.some((s) => s === "PRINTING");
  const anyFailed = itemStatuses.some((s) => s === "FAILED");
  if (anyFailed && !anyPrinting) {
    return "FAILED";
  }
  return "PRINTING";
}

// ---------------------------------------------------------------------------
// Read models (adapter returns money as exact decimal strings).
// ---------------------------------------------------------------------------

export interface OrderDocRef {
  id: string;
  originalFileName: string;
  contentType: string | null;
  fileSize: number;
  pageCount: number;
  uploadedAt: Date;
  parentDocumentId: string | null;
}

export interface OrderItemRow {
  id: string;
  document: OrderDocRef | null;
  printType: string;
  colorMode: string;
  paperSize: string;
  printSide: string;
  pageRange: string;
  copies: number;
  calculatedPages: number;
  unitPrice: string;
  itemPrice: string;
  printStatus: string;
  createdAt: Date;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  publicToken: string;
  shopId: string;
  shopName: string;
  items: OrderItemRow[];
  totalPrice: string;
  paymentMethod: string;
  paymentStatus: string;
  printStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
}

export interface OrderStore extends PricingStore {
  findShopById(shopId: string): Promise<{ id: string; isOpen: boolean | null } | null>;
  findDocumentById(documentId: string): Promise<{ id: string; shopId: string | null; pageCount: number } | null>;
  existsOrderNumber(orderNumber: string): Promise<boolean>;
  saveNewOrder(input: {
    orderNumber: string;
    shopId: string;
    customerName: string;
    customerPhone: string;
    paymentMethod: string;
    razorpayOrderId: string | null;
    legacy: {
      documentId: string | null;
      printType: string | null;
      colorMode: string | null;
      paperSize: string | null;
      printSide: string | null;
      pageRange: string | null;
      copies: number | null;
      calculatedPages: number | null;
    };
    items: Array<{
      documentId: string;
      printType: string;
      colorMode: string;
      paperSize: string;
      printSide: string;
      pageRange: string;
      copies: number;
      calculatedPages: number;
      unitPrice: string;
      itemPrice: string;
    }>;
    totalPaise: number;
    createJob: boolean;
  }): Promise<OrderRow>;
  findOrderById(orderId: string): Promise<OrderRow | null>;
  findOrderByPublicToken(publicToken: string): Promise<OrderRow | null>;
  findOrdersByShop(shopId: string, printStatus: string | null): Promise<OrderRow[]>;
  applyPrintStatus(
    orderId: string,
    printStatus: string,
    jobAction: "ensure-queued" | "complete" | "fail" | "reset-or-create" | "none"
  ): Promise<OrderRow>;
  applyItemPrintStatus(
    orderId: string,
    itemId: string,
    printStatus: string,
    derivedStatus: string
  ): Promise<OrderRow>;
  applyDocumentSwap(
    orderId: string,
    itemId: string,
    documentId: string,
    calculatedPages: number,
    unitPrice: string,
    itemPrice: string,
    totalPaise: number,
    mirrorLegacy: boolean
  ): Promise<OrderRow>;
  findDocumentLineage(
    documentId: string
  ): Promise<{ rootId: string; siblings: OrderDocRef[]; byId: Map<string, OrderDocRef> }>;
  existsDocumentInShop(shopId: string, documentId: string): Promise<boolean>;
  findPaymentByOrderId(
    orderId: string
  ): Promise<{ transactionId: string | null } | null>;
  applyPaymentStatus(
    orderId: string,
    paymentStatus: string,
    transactionId: string | null,
    createJob: boolean
  ): Promise<OrderRow>;
  deleteOrderGraph(orderId: string): Promise<void>;
  findPaymentStatus(orderId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// DTO mapping (mapToDTO, incl. legacy first-item mirror).
// ---------------------------------------------------------------------------

export interface OrderDTOBody {
  id: string;
  orderNumber: string;
  publicToken: string;
  shopId: string;
  shopName: string;
  items: Array<{
    id: string;
    orderId: string;
    document: {
      id: string;
      originalFileName: string;
      contentType: string | null;
      fileSize: number;
      pageCount: number;
      uploadedAt: string;
    } | null;
    printType: string;
    colorMode: string;
    paperSize: string;
    printSide: string;
    pageRange: string;
    copies: number;
    calculatedPages: number;
    unitPrice: number;
    itemPrice: number;
    printStatus: string;
    createdAt: string;
  }>;
  totalPrice: number;
  paymentMethod: string;
  paymentStatus: string;
  printStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: string;
  updatedAt: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  document: OrderDTOBody["items"][number]["document"];
  printType: string | null;
  colorMode: string | null;
  paperSize: string | null;
  printSide: string | null;
  pageRange: string | null;
  copies: number;
  calculatedPages: number;
}

function toDocDTO(d: OrderDocRef | null) {
  if (d == null) {
    return null;
  }
  return {
    id: d.id,
    originalFileName: d.originalFileName,
    contentType: d.contentType,
    fileSize: d.fileSize,
    pageCount: d.pageCount,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

export function mapOrderToDTO(order: OrderRow): OrderDTOBody {
  const items = order.items.map((item) => ({
    id: item.id,
    orderId: order.id,
    document: toDocDTO(item.document),
    printType: item.printType,
    colorMode: item.colorMode,
    paperSize: item.paperSize,
    printSide: item.printSide,
    pageRange: item.pageRange,
    copies: item.copies,
    calculatedPages: item.calculatedPages,
    unitPrice: Number(paiseToDecimal(decimalToPaise(item.unitPrice))),
    itemPrice: Number(paiseToDecimal(decimalToPaise(item.itemPrice))),
    printStatus: item.printStatus,
    createdAt: item.createdAt.toISOString(),
  }));
  const first = items[0];
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    publicToken: order.publicToken,
    shopId: order.shopId,
    shopName: order.shopName,
    items,
    totalPrice: Number(paiseToDecimal(decimalToPaise(order.totalPrice))),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    printStatus: order.printStatus,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
    document: first ? first.document : null,
    printType: first ? first.printType : null,
    colorMode: first ? first.colorMode : null,
    paperSize: first ? first.paperSize : null,
    printSide: first ? first.printSide : null,
    pageRange: first ? first.pageRange : null,
    copies: first ? first.copies : 0,
    calculatedPages: first ? first.calculatedPages : 0,
  };
}

// ---------------------------------------------------------------------------
// Order number + Razorpay helpers.
// ---------------------------------------------------------------------------

function randomOrderNumber(): string {
  let suffix = "";
  for (let i = 0; i < ORDER_NUMBER_LENGTH; i++) {
    suffix += ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)]!;
  }
  return `PR-${suffix}`;
}

function fallbackOrderNumber(): string {
  let seed = Date.now();
  let suffix = "";
  for (let i = 0; i < ORDER_NUMBER_LENGTH; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    suffix += ORDER_NUMBER_ALPHABET[seed % ORDER_NUMBER_ALPHABET.length]!;
  }
  return `PR-${suffix}`;
}

export async function mintOrderNumber(
  exists: (candidate: string) => Promise<boolean>
): Promise<string> {
  let orderNumber = randomOrderNumber();
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!(await exists(orderNumber))) {
      return orderNumber;
    }
    orderNumber = randomOrderNumber();
  }
  return fallbackOrderNumber();
}

function isOrderNumberConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === ORDER_NUMBER_CONFLICT
  );
}

export const ORDER_NUMBER_CONFLICT = "ORDER_NUMBER_CONFLICT";

export interface RazorpayGateway {
  isDummy(): boolean;
  isTestMode(): boolean;
  createOrder(amountPaise: number, receipt: string): Promise<string>;
}

export function testRazorpayOrderId(): string {
  return `order_test_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Input validation (CreateOrderRequest + CreateOrderItemRequest messages).
// ---------------------------------------------------------------------------

export interface OrderItemInput {
  documentId: unknown;
  printType: unknown;
  colorMode: unknown;
  paperSize: unknown;
  printSide: unknown;
  pageRange?: unknown;
  copies?: unknown;
}

export interface CreateOrderInput {
  shopId: unknown;
  paymentMethod: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  items?: unknown;
  documentId?: unknown;
  printType?: unknown;
  colorMode?: unknown;
  paperSize?: unknown;
  printSide?: unknown;
  pageRange?: unknown;
  copies?: unknown;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ValidatedItem {
  documentId: string;
  printType: string;
  colorMode: string;
  paperSize: string;
  printSide: string;
  pageRange: string;
  copies: number;
}

function validateItem(raw: any): ValidatedItem {
  const documentId = raw?.documentId;
  if (documentId == null || (typeof documentId === "string" && documentId.length === 0)) {
    throw new OrderError("Document ID is required", 400);
  }
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    throw new OrderError("Malformed request body", 400);
  }
  for (const [field, message] of [
    ["colorMode", "Color mode is required"],
    ["paperSize", "Paper size is required"],
    ["printSide", "Print side is required"],
  ] as Array<[string, string]>) {
    const v = raw?.[field];
    if (v == null || (typeof v === "string" && v.length === 0)) {
      throw new OrderError(message, 400);
    }
  }
  for (const [field, allowed] of [
    ["printType", ["PRINT", "XEROX", "PASSPORT_PHOTO"]],
    ["colorMode", ["BW", "COLOR"]],
    ["paperSize", ["A4", "A3"]],
    ["printSide", ["SINGLE", "DOUBLE"]],
  ] as Array<[string, string[]]>) {
    const v = field === "printType" && raw?.[field] == null ? "PRINT" : raw?.[field];
    if (typeof v !== "string" || !allowed.includes(v)) {
      throw new OrderError("Malformed request body", 400);
    }
  }
  const copiesRaw = raw?.copies === undefined ? 1 : raw?.copies === null ? 0 : raw?.copies;
  if (typeof copiesRaw !== "number" || !Number.isInteger(copiesRaw)) {
    throw new OrderError("Malformed request body", 400);
  }
  if (copiesRaw < 1) {
    throw new OrderError("Copies must be at least 1", 400);
  }
  const pageRange =
    raw?.pageRange == null ? "ALL" : String(raw.pageRange);
  return {
    documentId,
    printType: raw?.printType ?? "PRINT",
    colorMode: raw.colorMode,
    paperSize: raw.paperSize,
    printSide: raw.printSide,
    pageRange,
    copies: copiesRaw,
  };
}

// ---------------------------------------------------------------------------
// createOrder (+ reads).
// ---------------------------------------------------------------------------

export interface OrderContext {
  store: OrderStore;
  /** Required only by createOrder (Razorpay order creation). */
  razorpay?: RazorpayGateway;
}

async function emit(
  ctx: OrderContext,
  shopId: string,
  event: OrderEvent
): Promise<void> {
  await publishEvent(readRealtimeConfig(), shopId, event);
}

export async function createOrder(
  ctx: OrderContext,
  input: CreateOrderInput
): Promise<OrderDTOBody> {
  assertServerRuntime("createOrder");
  const shopId = input.shopId;
  if (shopId == null || (typeof shopId === "string" && shopId.length === 0)) {
    throw new OrderError("Shop ID is required", 400);
  }
  if (typeof shopId !== "string" || !UUID_PATTERN.test(shopId)) {
    throw new OrderError("Malformed request body", 400);
  }
  const paymentMethod = input.paymentMethod;
  if (paymentMethod == null || (typeof paymentMethod === "string" && paymentMethod.length === 0)) {
    throw new OrderError("Payment method is required", 400);
  }
  if (typeof paymentMethod !== "string" || !PAYMENT_METHODS.has(paymentMethod)) {
    throw new OrderError("Malformed request body", 400);
  }

  const shop = await ctx.store.findShopById(shopId);
  if (shop == null) {
    throw new OrderError("Shop not found", 400);
  }
  if (shop.isOpen === false) {
    throw new OrderError(
      "Shop is currently closed and not accepting new orders.",
      400
    );
  }

  let itemInputs: any[] = Array.isArray(input.items) ? input.items : [];
  if (itemInputs.length === 0 && input.documentId != null) {
    itemInputs = [
      {
        documentId: input.documentId,
        printType: input.printType,
        colorMode: input.colorMode,
        paperSize: input.paperSize,
        printSide: input.printSide,
        pageRange: input.pageRange,
        copies: input.copies,
      },
    ];
  }
  if (itemInputs.length === 0) {
    throw new OrderError("Order must contain at least one document item", 400);
  }

  let orderNumber = await mintOrderNumber((n) => ctx.store.existsOrderNumber(n));

  const customerName =
    typeof input.customerName === "string" && input.customerName.trim().length > 0
      ? input.customerName.trim()
      : "Walk-in Customer";
  const customerPhone =
    typeof input.customerPhone === "string" ? input.customerPhone.trim() : "";

  const builtItems: Array<{
    documentId: string;
    printType: string;
    colorMode: string;
    paperSize: string;
    printSide: string;
    pageRange: string;
    copies: number;
    calculatedPages: number;
    unitPrice: string;
    itemPrice: string;
  }> = [];
  let totalPaise = 0;
  for (const raw of itemInputs) {
    const item = validateItem(raw);
    const doc = await ctx.store.findDocumentById(item.documentId);
    if (doc == null) {
      throw new OrderError(`Document not found: ${item.documentId}`, 400);
    }
    if (doc.shopId != null && doc.shopId !== shop.id) {
      throw new OrderError(
        `Document does not belong to this shop: ${item.documentId}`,
        400
      );
    }
    if (item.copies > MAX_COPIES_PER_ITEM) {
      throw new OrderError(
        `Copies per item cannot exceed ${MAX_COPIES_PER_ITEM}`,
        400
      );
    }
    const pricing = await calculatePrice(ctx.store, {
      shopId: shop.id,
      documentId: doc.id,
      printType: item.printType,
      colorMode: item.colorMode,
      paperSize: item.paperSize,
      printSide: item.printSide,
      pageRange: item.pageRange,
      copies: item.copies,
    });
    const copies = item.copies > 0 ? Math.min(item.copies, MAX_COPIES_PER_ITEM) : 1;
    builtItems.push({
      documentId: doc.id,
      printType: item.printType,
      colorMode: item.colorMode,
      paperSize: item.paperSize,
      printSide: item.printSide,
      pageRange: item.pageRange,
      copies,
      calculatedPages: pricing.calculatedPages,
      unitPrice: paiseToDecimal(decimalToPaise(String(pricing.unitPricePerPage))),
      itemPrice: paiseToDecimal(decimalToPaise(String(pricing.totalPrice))),
    });
    totalPaise += decimalToPaise(String(pricing.totalPrice));
  }

  let razorpayOrderId: string | null = null;
  if (paymentMethod === "ONLINE") {
    const gateway = ctx.razorpay;
    const dummy = gateway == null || gateway.isDummy();
    const testMode = gateway?.isTestMode() ?? false;
    if (dummy) {
      if (testMode) {
        razorpayOrderId = testRazorpayOrderId();
      } else {
        throw new OrderError(
          "Online payments are unavailable: Razorpay is not configured. Please use Pay at Shop.",
          503
        );
      }
    } else {
      if (!Number.isSafeInteger(totalPaise)) {
        throw new OrderError("An internal server error occurred", 500);
      }
      try {
        razorpayOrderId = await gateway.createOrder(totalPaise, orderNumber);
      } catch {
        throw new OrderError("Failed to create Razorpay order", 500);
      }
    }
  }

  const first = builtItems[0]!;
  // M-04: order-number collision (unique constraint) — retry with a fresh
  // number, up to 3 save attempts like saveWithOrderNumberRetry.
  const baseInput = {
    shopId: shop.id,
    customerName,
    customerPhone,
    paymentMethod,
    razorpayOrderId,
    legacy: {
      documentId: first.documentId,
      printType: first.printType,
      colorMode: first.colorMode,
      paperSize: first.paperSize,
      printSide: first.printSide,
      pageRange: first.pageRange,
      copies: first.copies,
      calculatedPages: first.calculatedPages,
    },
    items: builtItems,
    totalPaise,
    createJob: paymentMethod === "PAY_AT_SHOP",
  };
  let saved: OrderRow | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      saved = await ctx.store.saveNewOrder({ ...baseInput, orderNumber });
      break;
    } catch (err) {
      if (!isOrderNumberConflict(err) || attempt === 2) {
        throw err;
      }
      orderNumber = await mintOrderNumber((n) => ctx.store.existsOrderNumber(n));
    }
  }
  const created = saved!;

  if (paymentMethod === "PAY_AT_SHOP" || created.paymentStatus === "PAID") {
    await emit(ctx, shop.id, {
      type: "NEW_PRINT_REQUEST",
      order: mapOrderToDTO(created),
    });
  }
  return mapOrderToDTO(created);
}

export async function getOrderByPublicToken(
  store: OrderStore,
  publicToken: string
): Promise<OrderDTOBody> {
  assertServerRuntime("getOrderByPublicToken");
  if (typeof publicToken !== "string" || !UUID_PATTERN.test(publicToken)) {
    throw new OrderError("Order not found with provided tracking token", 400);
  }
  const order = await store.findOrderByPublicToken(publicToken);
  if (order == null) {
    throw new OrderError("Order not found with provided tracking token", 400);
  }
  return mapOrderToDTO(order);
}

export async function getOrderById(
  store: OrderStore,
  orderId: string
): Promise<OrderDTOBody> {
  assertServerRuntime("getOrderById");
  const order = await store.findOrderById(orderId);
  if (order == null) {
    throw new OrderError("Order not found", 400);
  }
  return mapOrderToDTO(order);
}

export async function getShopOrders(
  store: OrderStore,
  shopId: string,
  status: string | null | undefined
): Promise<OrderDTOBody[]> {
  assertServerRuntime("getShopOrders");
  let filter: string | null = null;
  if (status != null && status.length > 0 && status.toUpperCase() !== "ALL") {
    const upper = status.toUpperCase();
    if (!PRINT_STATUSES.has(upper)) {
      throw new OrderError(`Invalid order status filter: ${status}`, 400);
    }
    filter = upper;
  }
  const orders = await store.findOrdersByShop(shopId, filter);
  return orders.map(mapOrderToDTO);
}

// ---------------------------------------------------------------------------
// Status transitions.
// ---------------------------------------------------------------------------

export async function updatePrintStatus(
  ctx: OrderContext,
  orderId: string,
  printStatus: unknown
): Promise<OrderDTOBody> {
  assertServerRuntime("updatePrintStatus");
  if (typeof printStatus !== "string" || !PRINT_STATUSES.has(printStatus)) {
    if (printStatus == null) {
      throw new OrderError("Print status must be specified", 400);
    }
    throw new OrderError("Malformed request body", 400);
  }
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new OrderError("Order not found", 400);
  }
  requireAllowedPrintTransition(order.printStatus, printStatus);
  paidGate(order.paymentMethod, order.paymentStatus, printStatus);
  const jobAction =
    printStatus === "PRINTING"
      ? "reset-or-create"
      : printStatus === "COMPLETED"
        ? "complete"
        : printStatus === "FAILED"
          ? "fail"
          : printStatus === "PENDING"
            ? "ensure-queued"
            : ("none" as const);
  const updated = await ctx.store.applyPrintStatus(orderId, printStatus, jobAction);
  const dto = mapOrderToDTO(updated);
  await emit(ctx, order.shopId, { type: "ORDER_STATUS_UPDATED", order: dto });
  return dto;
}

export async function updateItemPrintStatus(
  ctx: OrderContext,
  orderId: string,
  itemId: string,
  printStatus: unknown,
  shopId: string | null
): Promise<OrderDTOBody> {
  assertServerRuntime("updateItemPrintStatus");
  if (typeof printStatus !== "string" || !PRINT_STATUSES.has(printStatus)) {
    if (printStatus == null) {
      throw new OrderError("Print status must be specified", 400);
    }
    throw new OrderError("Malformed request body", 400);
  }
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new OrderError("Order not found", 400);
  }
  if (shopId != null && order.shopId !== shopId) {
    throw new OrderError("Unauthorized access to shop order", 400);
  }
  const item = order.items.find((i) => i.id === itemId);
  if (item == null) {
    throw new OrderError(`Order item not found: ${itemId}`, 400);
  }
  requireAllowedPrintTransition(item.printStatus, printStatus);
  paidGate(order.paymentMethod, order.paymentStatus, printStatus);
  const derived = deriveOrderStatus(
    order.items.map((i) => (i.id === itemId ? printStatus : i.printStatus))
  );
  const updated = await ctx.store.applyItemPrintStatus(
    orderId,
    itemId,
    printStatus,
    derived
  );
  const dto = mapOrderToDTO(updated);
  await emit(ctx, order.shopId, { type: "ORDER_ITEM_STATUS_UPDATED", order: dto });
  return dto;
}

export async function swapItemDocument(
  ctx: OrderContext,
  orderId: string,
  itemId: string,
  documentId: string,
  shopId: string | null
): Promise<OrderDTOBody> {
  assertServerRuntime("swapItemDocument");
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new OrderError("Order not found", 400);
  }
  if (shopId != null && order.shopId !== shopId) {
    throw new OrderError("Unauthorized access to shop order", 400);
  }
  if (order.paymentStatus === "PAID") {
    throw new OrderError("Cannot change the document of a paid order", 409);
  }
  if (order.printStatus === "PRINTING") {
    throw new OrderError("Cannot change the document while the order is printing", 409);
  }
  const item = order.items.find((i) => i.id === itemId);
  if (item == null) {
    throw new OrderError(`Order item not found: ${itemId}`, 400);
  }
  const doc = await ctx.store.findDocumentById(documentId);
  if (doc == null) {
    throw new OrderError(`Document not found: ${documentId}`, 400);
  }
  const accessible =
    (await ctx.store.existsDocumentInShop(order.shopId, documentId)) ||
    (shopId != null &&
      (await ctx.store.findDocumentById(documentId))?.shopId === shopId);
  if (!accessible) {
    throw new OrderError("Document does not belong to this shop", 400);
  }
  const pricing = await calculatePrice(ctx.store, {
    shopId: order.shopId,
    documentId: doc.id,
    printType: item.printType,
    colorMode: item.colorMode,
    paperSize: item.paperSize,
    printSide: item.printSide,
    pageRange: item.pageRange,
    copies: item.copies,
  });
  const unitPaise = decimalToPaise(String(pricing.unitPricePerPage));
  const itemPaise = decimalToPaise(String(pricing.totalPrice));
  let totalPaise = 0;
  for (const i of order.items) {
    totalPaise += i.id === itemId ? itemPaise : decimalToPaise(i.itemPrice);
  }
  const mirrorLegacy = order.items.length > 0 && order.items[0]!.id === itemId;
  const updated = await ctx.store.applyDocumentSwap(
    orderId,
    itemId,
    documentId,
    pricing.calculatedPages,
    paiseToDecimal(unitPaise),
    paiseToDecimal(itemPaise),
    totalPaise,
    mirrorLegacy
  );
  return mapOrderToDTO(updated);
}

export async function getItemDocumentVersions(
  ctx: OrderContext,
  orderId: string,
  itemId: string,
  shopId: string | null
): Promise<
  Array<{
    id: string;
    originalFileName: string;
    contentType: string | null;
    fileSize: number;
    pageCount: number;
    uploadedAt: string;
    parentDocumentId: string | null;
    current: boolean;
  }>
> {
  assertServerRuntime("getItemDocumentVersions");
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new OrderError("Order not found", 400);
  }
  if (shopId != null && order.shopId !== shopId) {
    throw new OrderError("Unauthorized access to shop order", 400);
  }
  const item = order.items.find((i) => i.id === itemId);
  if (item == null) {
    throw new OrderError(`Order item not found: ${itemId}`, 400);
  }
  if (item.document == null) {
    return [];
  }
  const current = item.document;
  const lineage = await ctx.store.findDocumentLineage(current.id);
  const family: OrderDocRef[] = [];
  const root = lineage.byId.get(lineage.rootId);
  if (root != null) {
    family.push(root);
  }
  for (const sibling of lineage.siblings) {
    if (sibling.id !== lineage.rootId) {
      family.push(sibling);
    }
  }
  if (!family.some((d) => d.id === current.id) && lineage.byId.get(current.id) == null) {
    family.push({ ...current });
  } else if (!family.some((d) => d.id === current.id)) {
    family.push(lineage.byId.get(current.id)!);
  }
  return family.map((d) => ({
    id: d.id,
    originalFileName: d.originalFileName,
    contentType: d.contentType,
    fileSize: d.fileSize,
    pageCount: d.pageCount,
    uploadedAt: d.uploadedAt.toISOString(),
    parentDocumentId: d.parentDocumentId,
    current: d.id === current.id,
  }));
}

export async function updatePaymentStatus(
  ctx: OrderContext,
  orderId: string,
  paymentStatus: unknown
): Promise<OrderDTOBody> {
  assertServerRuntime("updatePaymentStatus");
  if (typeof paymentStatus !== "string" || !PAYMENT_STATUSES.has(paymentStatus)) {
    if (paymentStatus == null) {
      throw new OrderError("Payment status must be specified", 400);
    }
    throw new OrderError("Malformed request body", 400);
  }
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new OrderError("Order not found", 400);
  }
  requireAllowedPaymentTransition(order.paymentStatus, paymentStatus);
  const existingPayment = await ctx.store.findPaymentByOrderId(orderId);
  let transactionId: string | null = null;
  if (paymentStatus === "PAID") {
    const current =
      existingPayment?.transactionId != null &&
      existingPayment.transactionId.trim().length > 0
        ? existingPayment.transactionId
        : null;
    transactionId =
      current ?? order.razorpayPaymentId ?? `CASH-${order.orderNumber}`;
  }
  const updated = await ctx.store.applyPaymentStatus(
    orderId,
    paymentStatus,
    transactionId,
    paymentStatus === "PAID"
  );
  const dto = mapOrderToDTO(updated);
  await emit(ctx, order.shopId, { type: "PAYMENT_STATUS_UPDATED", order: dto });
  return dto;
}

export async function deleteOrder(
  ctx: OrderContext,
  orderId: string,
  shopId: string | null,
  confirm: boolean
): Promise<void> {
  assertServerRuntime("deleteOrder");
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new OrderError(`Order not found with ID: ${orderId}`, 400);
  }
  if (shopId == null || order.shopId !== shopId) {
    const err = new OrderError("Unauthorized access to shop order", 403);
    throw err;
  }
  if (order.printStatus === "PRINTING") {
    throw new OrderError("Cannot delete an order that is currently printing", 409);
  }
  const linkedStatus = await ctx.store.findPaymentStatus(orderId);
  if (linkedStatus === "PAID" || order.paymentStatus === "PAID") {
    throw new OrderError(
      "Cannot delete a PAID order while its payment record exists. Refund or mark the payment FAILED first.",
      409
    );
  }
  if (order.printStatus === "COMPLETED" && !confirm) {
    throw new OrderError(
      "Deleting a COMPLETED order requires explicit confirmation (confirm=true)",
      409
    );
  }
  await ctx.store.deleteOrderGraph(orderId);
}
