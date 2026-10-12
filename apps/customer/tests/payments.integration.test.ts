import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { prisma } from "@printdrop/db";
import {
  makeShopWithOwner,
  uploadPdf,
  json,
  post,
  tag,
  cleanupAll,
} from "./helpers.js";
import { POST as createOrder } from "../app/api/public/orders/route.js";
import { POST as createPayment } from "../app/api/public/payments/create/route.js";
import { POST as verifyPayment } from "../app/api/public/payments/verify/route.js";
import { POST as cancelPayment } from "../app/api/public/payments/cancel/route.js";
import { POST as webhook } from "../app/api/public/payments/webhook/route.js";

// Payment integration tests (RAZORPAY_TEST_MODE=true, test-only HMAC
// keys via process env). Isolated test DB only; per-case cleanup.

const TEST_SECRET = "dummy_secret";
const TEST_WEBHOOK_SECRET = "dummy_webhook_secret";

function sign(orderId: string, paymentId: string): string {
  return createHmac("sha256", TEST_SECRET)
    .update(`${orderId}|${paymentId}`, "utf8")
    .digest("hex");
}

function signWebhook(raw: string): string {
  return createHmac("sha256", TEST_WEBHOOK_SECRET)
    .update(raw, "utf8")
    .digest("hex");
}

async function makeOnlineOrder(shopId: string, docId: string) {
  const r = await json(
    createOrder,
    "/api/public/orders",
    post("/api/public/orders", {
      shopId,
      paymentMethod: "ONLINE",
      customerName: "Paying",
      items: [
        { documentId: docId, colorMode: "BW", paperSize: "A4", printSide: "SINGLE" },
      ],
    })
  );
  if (r.status !== 200) {
    throw new Error(`order failed: ${JSON.stringify(r.body)}`);
  }
  return r.body.data;
}

beforeEach(() => {
  // Legacy test-profile literals: dummy keys + explicit test mode engage
  // the offline order_test_* path (no network, HMAC still verified).
  process.env["RAZORPAY_TEST_MODE"] = "true";
  process.env["RAZORPAY_KEY_ID"] = "rzp_test_dummy";
  process.env["RAZORPAY_KEY_SECRET"] = TEST_SECRET;
  process.env["RAZORPAY_WEBHOOK_SECRET"] = TEST_WEBHOOK_SECRET;
});

afterEach(async () => {
  delete process.env["RAZORPAY_TEST_MODE"];
  delete process.env["RAZORPAY_KEY_ID"];
  delete process.env["RAZORPAY_KEY_SECRET"];
  delete process.env["RAZORPAY_WEBHOOK_SECRET"];
  await cleanupAll();
});

describe("online payments (test-mode Razorpay)", () => {
  it("creates test razorpay orders and verifies HMAC success + idempotency", async () => {
    const { shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 5);
    const order = await makeOnlineOrder(shopId, docId);
    expect(order.razorpayOrderId).toMatch(/^order_test_/);
    expect(order.paymentStatus).toBe("PENDING");
    expect(
      await prisma.printJob.findUnique({ where: { orderId: order.id } })
    ).toBeNull();

    const payId = `pay_${tag("p")}`;
    const sig = sign(order.razorpayOrderId, payId);
    const v = await json(
      verifyPayment,
      "/api/public/payments/verify",
      post("/api/public/payments/verify", {
        orderId: order.id,
        razorpayPaymentId: payId,
        razorpayOrderId: order.razorpayOrderId,
        razorpaySignature: sig,
      })
    );
    expect(v.status).toBe(200);
    expect(v.body.message).toBe("Payment verified successfully");
    expect(v.body.data.status).toBe("PAID");
    expect(v.body.data.transactionId).toBe(payId);
    const job = await prisma.printJob.findUnique({
      where: { orderId: order.id },
    });
    expect(job?.status).toBe("QUEUED");

    // Idempotent re-verify: same PAID result, no duplicate job.
    const v2 = await json(
      verifyPayment,
      "/api/public/payments/verify",
      post("/api/public/payments/verify", {
        orderId: order.id,
        razorpayPaymentId: payId,
        razorpayOrderId: order.razorpayOrderId,
        razorpaySignature: sig,
      })
    );
    expect(v2.status).toBe(200);
    expect(v2.body.data.status).toBe("PAID");
    expect(
      await prisma.printJob.count({ where: { orderId: order.id } })
    ).toBe(1);
  });

  it("persists FAILED on bad signatures and cancels pending payments", async () => {
    const { shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 1);
    const order = await makeOnlineOrder(shopId, docId);
    const bad = await json(
      verifyPayment,
      "/api/public/payments/verify",
      post("/api/public/payments/verify", {
        orderId: order.id,
        razorpayPaymentId: "pay_x",
        razorpayOrderId: order.razorpayOrderId,
        razorpaySignature: "0".repeat(64),
      })
    );
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Invalid Razorpay payment signature");
    const row = await prisma.printOrder.findUnique({ where: { id: order.id } });
    expect(row?.paymentStatus).toBe("FAILED");

    const order2 = await makeOnlineOrder(shopId, docId);
    const cancel = await json(
      cancelPayment,
      "/api/public/payments/cancel",
      post("/api/public/payments/cancel", {
        orderId: order2.id,
        razorpayOrderId: order2.razorpayOrderId,
      })
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.message).toBe("Payment marked as cancelled");
    expect(cancel.body.data.status).toBe("FAILED");

    const create = await json(
      createPayment,
      "/api/public/payments/create",
      post("/api/public/payments/create", {
        orderId: order2.id,
        paymentMethod: "ONLINE",
      })
    );
    expect(create.status).toBe(400);
    expect(create.body.message).toBe(
      "Payment can only be initiated for orders with PENDING payment status"
    );
  });

  it("handles webhooks: captured -> PAID, failed -> FAILED, bad signature 400", async () => {
    const { shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 2);
    const order = await makeOnlineOrder(shopId, docId);
    const totalPaise = Math.round(order.totalPrice * 100);

    const captured = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_hook1",
            order_id: order.razorpayOrderId,
            amount: totalPaise,
          },
        },
      },
    });
    const hookRes = await webhook(
      new Request("http://localhost/api/public/payments/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": signWebhook(captured),
        },
        body: captured,
      })
    );
    expect(hookRes.status).toBe(200);
    expect(await hookRes.json()).toEqual({ status: "ok" });
    expect(
      (await prisma.printOrder.findUnique({ where: { id: order.id } }))
        ?.paymentStatus
    ).toBe("PAID");

    // Under-paid capture is ignored, duplicate delivery is idempotent.
    const short = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_hook2",
            order_id: order.razorpayOrderId,
            amount: totalPaise - 1,
          },
        },
      },
    });
    const shortRes = await webhook(
      new Request("http://localhost/api/public/payments/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": signWebhook(short),
        },
        body: short,
      })
    );
    expect(shortRes.status).toBe(200);
    expect(
      (await prisma.printOrder.findUnique({ where: { id: order.id } }))
        ?.razorpayPaymentId
    ).toBe("pay_hook1");

    const order2 = await makeOnlineOrder(shopId, docId);
    const failed = JSON.stringify({
      event: "payment.failed",
      payload: {
        payment: { entity: { id: "pay_f1", order_id: order2.razorpayOrderId } },
      },
    });
    await webhook(
      new Request("http://localhost/api/public/payments/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": signWebhook(failed),
        },
        body: failed,
      })
    );
    expect(
      (await prisma.printOrder.findUnique({ where: { id: order2.id } }))
        ?.paymentStatus
    ).toBe("FAILED");

    const forged = await webhook(
      new Request("http://localhost/api/public/payments/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": "0".repeat(64),
        },
        body: failed,
      })
    );
    expect(forged.status).toBe(400);
  });

  it("fails closed without test mode or keys (503)", async () => {
    delete process.env["RAZORPAY_TEST_MODE"];
    delete process.env["RAZORPAY_KEY_ID"];
    delete process.env["RAZORPAY_KEY_SECRET"];
    const { shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 1);
    const r = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", {
        shopId,
        paymentMethod: "ONLINE",
        items: [
          { documentId: docId, colorMode: "BW", paperSize: "A4", printSide: "SINGLE" },
        ],
      })
    );
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/not configured/);
  });
});
