import { createHmac, timingSafeEqual } from "node:crypto";
import { assertServerRuntime } from "./serverOnly.js";
import { decimalToPaise } from "./pricing.js";
import { publishEvent, readRealtimeConfig } from "./events.js";
import { mapOrderToDTO, type OrderRow } from "./orders.js";

// Payment flows. Sources: backend/.../service/PaymentService.java (full
// transcription: PENDING-only creation, C-07 shop binding, TXN/CASH ids,
// idempotent PAID verify, C-01 order/amount binding, FAILED persistence
// WITHOUT rollback on bad signature, cancel ownership proof, webhook
// amount gate + event matrix) + PublicPaymentController messages.
// Razorpay SDK calls stay behind the RazorpayGateway seam (test-mode and
// dummy-key behavior mirror OrderService/PaymentService exactly).

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 503 | 500 = 400
  ) {
    super(message);
  }
}

export interface PaymentRow {
  id: string;
  orderId: string;
  transactionId: string | null;
  amount: string;
  paymentMethod: string;
  status: string;
}

export interface PaymentOrderRow {
  id: string;
  shopId: string;
  orderNumber: string;
  totalPrice: string;
  paymentMethod: string;
  paymentStatus: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
}

export interface PaymentStore {
  findOrderById(orderId: string): Promise<PaymentOrderRow | null>;
  findPaymentByOrderId(orderId: string): Promise<PaymentRow | null>;
  savePayment(input: {
    orderId: string;
    transactionId: string | null;
    amount: string;
    paymentMethod: string;
    status: string;
  }): Promise<PaymentRow>;
  applyVerifiedPayment(input: {
    orderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    ensureJob: boolean;
  }): Promise<{ payment: PaymentRow; order: OrderRow }>;
  applyFailedPayment(orderId: string): Promise<PaymentRow>;
  applyCancelledPayment(orderId: string): Promise<PaymentRow>;
  applyWebhookPaid(input: {
    orderId: string;
    shopId: string;
    razorpayPaymentId: string | null;
    ensureJob: boolean;
  }): Promise<void>;
  applyWebhookFailed(orderId: string): Promise<void>;
  findOrderByRazorpayOrderId(razorpayOrderId: string): Promise<PaymentOrderRow | null>;
  toOrderDTO(orderId: string): Promise<OrderRow>;
}

export interface PaymentContext {
  store: PaymentStore;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  testMode: boolean;
}

export function isDummyRazorpay(keyId: string, keySecret: string): boolean {
  return (
    keyId.trim().length === 0 ||
    keySecret.trim().length === 0 ||
    keyId.startsWith("rzp_test_dummy") ||
    keySecret === "dummy_secret"
  );
}

function requireRealKeys(ctx: PaymentContext): void {
  if (ctx.testMode) {
    return;
  }
  if (isDummyRazorpay(ctx.razorpayKeyId, ctx.razorpayKeySecret)) {
    throw new PaymentError(
      "Online payments are unavailable: Razorpay is not configured. Please use Pay at Shop.",
      503
    );
  }
}

export function toPaymentDTO(p: PaymentRow): {
  id: string;
  orderId: string;
  transactionId: string | null;
  amount: number;
  paymentMethod: string;
  status: string;
} {
  return {
    id: p.id,
    orderId: p.orderId,
    transactionId: p.transactionId,
    amount: Number(
      (() => {
        const paise = decimalToPaise(p.amount);
        const neg = paise < 0;
        const abs = Math.abs(paise);
        const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
        return neg ? `-${text}` : text;
      })()
    ),
    paymentMethod: p.paymentMethod,
    status: p.status,
  };
}

export async function createPayment(
  ctx: PaymentContext,
  orderId: unknown,
  paymentMethod: unknown,
  shopId: unknown
): Promise<ReturnType<typeof toPaymentDTO>> {
  assertServerRuntime("createPayment");
  if (orderId == null || (typeof orderId === "string" && orderId.length === 0)) {
    throw new PaymentError("Order ID is required", 400);
  }
  if (
    typeof orderId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
  ) {
    throw new PaymentError("Malformed request body", 400);
  }
  if (paymentMethod == null || (typeof paymentMethod === "string" && paymentMethod.length === 0)) {
    throw new PaymentError("Payment method is required", 400);
  }
  if (
    typeof paymentMethod !== "string" ||
    (paymentMethod !== "ONLINE" && paymentMethod !== "PAY_AT_SHOP")
  ) {
    throw new PaymentError("Malformed request body", 400);
  }
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new PaymentError(`Order not found with ID: ${orderId}`, 400);
  }
  if (shopId != null && typeof shopId === "string" && shopId.length > 0) {
    if (order.shopId !== shopId) {
      throw new PaymentError("Order does not belong to the specified shop", 400);
    }
  }
  if (order.paymentStatus !== "PENDING") {
    throw new PaymentError(
      "Payment can only be initiated for orders with PENDING payment status",
      400
    );
  }
  if (paymentMethod === "ONLINE") {
    requireRealKeys(ctx);
  }
  const txId =
    paymentMethod === "PAY_AT_SHOP"
      ? `CASH-${order.orderNumber}`
      : `TXN-${Date.now()}`;
  const saved = await ctx.store.savePayment({
    orderId,
    transactionId: txId,
    amount: order.totalPrice,
    paymentMethod,
    status: "PENDING",
  });
  return toPaymentDTO(saved);
}

/** HMAC-SHA256(orderId|paymentId) === signature (Razorpay verify canon). */
export function verifyRazorpaySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  keySecret: string
): boolean {
  try {
    const expected = createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`, "utf8")
      .digest();
    const actual = Buffer.from(razorpaySignature, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): boolean {
  try {
    const expected = createHmac("sha256", webhookSecret)
      .update(rawBody, "utf8")
      .digest();
    const actual = Buffer.from(signatureHeader, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function verifyPayment(
  ctx: PaymentContext,
  orderId: unknown,
  razorpayPaymentId: unknown,
  razorpayOrderId: unknown,
  razorpaySignature: unknown
): Promise<ReturnType<typeof toPaymentDTO>> {
  assertServerRuntime("verifyPayment");
  if (
    typeof orderId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
  ) {
    throw new PaymentError("Order not found", 400);
  }
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new PaymentError(`Order not found with ID: ${orderId}`, 400);
  }
  if (order.paymentMethod !== "ONLINE") {
    throw new PaymentError("Order is not an online payment order", 400);
  }
  // Idempotent PAID short-circuit (no duplicate side effects).
  if (order.paymentStatus === "PAID") {
    const existing = await ctx.store.findPaymentByOrderId(orderId);
    if (existing == null) {
      const created = await ctx.store.savePayment({
        orderId,
        transactionId: typeof razorpayPaymentId === "string" ? razorpayPaymentId : null,
        amount: order.totalPrice,
        paymentMethod: "ONLINE",
        status: "PAID",
      });
      return toPaymentDTO(created);
    }
    return toPaymentDTO(existing);
  }
  if (
    typeof razorpayPaymentId !== "string" ||
    typeof razorpayOrderId !== "string" ||
    typeof razorpaySignature !== "string" ||
    razorpayPaymentId.length === 0 ||
    razorpayOrderId.length === 0 ||
    razorpaySignature.length === 0
  ) {
    throw new PaymentError("Missing Razorpay payment verification parameters", 400);
  }
  requireRealKeys(ctx);
  if (order.razorpayOrderId == null || order.razorpayOrderId !== razorpayOrderId) {
    throw new PaymentError("Razorpay order id does not match this order", 400);
  }
  const expectedPaise = decimalToPaise(order.totalPrice);
  if (expectedPaise <= 0) {
    throw new PaymentError("Order total is invalid for payment verification", 400);
  }
  const existing = await ctx.store.findPaymentByOrderId(orderId);
  if (existing != null && decimalToPaise(existing.amount) !== expectedPaise) {
    throw new PaymentError("Payment amount does not match order total", 400);
  }
  const valid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    ctx.razorpayKeySecret
  );
  if (!valid) {
    // noRollbackFor semantics: FAILED persists, THEN the error surfaces.
    const failed = await ctx.store.applyFailedPayment(orderId);
    void failed;
    throw new PaymentError("Invalid Razorpay payment signature", 400);
  }
  const { payment, order: updated } = await ctx.store.applyVerifiedPayment({
    orderId,
    razorpayPaymentId,
    razorpaySignature,
    ensureJob: true,
  });
  await publishEvent(readRealtimeConfig(), order.shopId, {
    type: "NEW_PRINT_REQUEST",
    order: mapOrderToDTO(updated),
  });
  return toPaymentDTO(payment);
}

export async function cancelPayment(
  ctx: PaymentContext,
  orderId: unknown,
  razorpayOrderId: unknown
): Promise<ReturnType<typeof toPaymentDTO>> {
  assertServerRuntime("cancelPayment");
  if (typeof orderId !== "string" || orderId.trim().length === 0) {
    throw new PaymentError("orderId is required", 400);
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)
  ) {
    throw new PaymentError("Order not found", 400);
  }
  const order = await ctx.store.findOrderById(orderId);
  if (order == null) {
    throw new PaymentError(`Order not found with ID: ${orderId}`, 400);
  }
  if (
    order.paymentMethod === "ONLINE" &&
    order.razorpayOrderId != null &&
    !order.razorpayOrderId.startsWith("order_test_")
  ) {
    if (typeof razorpayOrderId !== "string" || razorpayOrderId !== order.razorpayOrderId) {
      throw new PaymentError(
        "Razorpay order id is required to cancel this online payment",
        400
      );
    }
  }
  if (order.paymentStatus === "PENDING") {
    const cancelled = await ctx.store.applyCancelledPayment(orderId);
    return toPaymentDTO(cancelled);
  }
  const existing = await ctx.store.findPaymentByOrderId(orderId);
  if (existing == null) {
    throw new PaymentError("Payment not found", 400);
  }
  return toPaymentDTO(existing);
}

export interface WebhookResult {
  status: "ok";
}

export async function handleWebhook(
  ctx: PaymentContext,
  rawPayload: string,
  signatureHeader: string | null
): Promise<WebhookResult> {
  assertServerRuntime("handleWebhook");
  if (
    !ctx.testMode &&
    (ctx.razorpayWebhookSecret.trim().length === 0 ||
      ctx.razorpayWebhookSecret === "dummy_webhook_secret")
  ) {
    const err = new PaymentError(
      "Payment webhooks are unavailable: webhook secret is not configured",
      503
    );
    throw err;
  }
  if (signatureHeader == null || signatureHeader.trim().length === 0) {
    throw new PaymentError("Missing Razorpay webhook signature header", 400);
  }
  let valid = false;
  try {
    valid = verifyRazorpayWebhookSignature(
      rawPayload,
      signatureHeader,
      ctx.razorpayWebhookSecret
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new PaymentError(
      "Webhook verification failed: Invalid Razorpay webhook signature",
      400
    );
  }
  let payload: any;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new PaymentError("Webhook verification failed: malformed payload", 400);
  }
  const eventType: string = payload?.event ?? "";
  if (eventType === "payment.captured" || eventType === "order.paid") {
    const paymentEntity =
      payload?.payload?.payment?.entity ?? null;
    const orderEntity = payload?.payload?.order?.entity ?? null;
    let razorpayOrderId: string | null = null;
    let razorpayPaymentId: string | null = null;
    let capturedPaise = -1;
    if (paymentEntity != null) {
      razorpayOrderId = paymentEntity.order_id ?? null;
      razorpayPaymentId = paymentEntity.id ?? null;
      capturedPaise =
        typeof paymentEntity.amount === "number" ? paymentEntity.amount : -1;
    } else if (orderEntity != null) {
      razorpayOrderId = orderEntity.id ?? null;
    }
    if (razorpayOrderId != null && razorpayOrderId.length > 0) {
      const order = await ctx.store.findOrderByRazorpayOrderId(razorpayOrderId);
      if (order != null && order.paymentStatus !== "PAID") {
        if (capturedPaise >= 0) {
          const expectedPaise = decimalToPaise(order.totalPrice);
          if (capturedPaise < expectedPaise) {
            return { status: "ok" };
          }
        }
        await ctx.store.applyWebhookPaid({
          orderId: order.id,
          shopId: order.shopId,
          razorpayPaymentId,
          ensureJob: true,
        });
        const dto = mapOrderToDTO(await ctx.store.toOrderDTO(order.id));
        await publishEvent(readRealtimeConfig(), order.shopId, {
          type: "NEW_PRINT_REQUEST",
          order: dto,
        });
      }
    }
  } else if (eventType === "payment.failed") {
    const paymentEntity = payload?.payload?.payment?.entity ?? null;
    const razorpayOrderId: string | null =
      paymentEntity != null ? (paymentEntity.order_id ?? null) : null;
    if (razorpayOrderId != null) {
      const order = await ctx.store.findOrderByRazorpayOrderId(razorpayOrderId);
      if (order != null && order.paymentStatus === "PENDING") {
        await ctx.store.applyWebhookFailed(order.id);
      }
    }
  }
  return { status: "ok" };
}
