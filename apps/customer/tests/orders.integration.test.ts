import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@printdrop/db";
import {
  makeShopWithOwner,
  uploadPdf,
  json,
  post,
  emails,
  shopIds,
  cleanupAll,
} from "./helpers.js";
import { POST as createOrder } from "../app/api/public/orders/route.js";
import { GET as getOrder } from "../app/api/public/orders/[publicToken]/route.js";
import { GET as listOrders } from "../app/api/admin/orders/route.js";

// Order API integration tests on the isolated test DB (printdrop_dev
// @5434). Tables come from the approved test setup; rows are test-only
// with per-case cleanup. No production contact.

afterEach(cleanupAll);

describe("POST /api/public/orders", () => {
  it("creates PAY_AT_SHOP orders with pricing, job, and legacy mirror", async () => {
    const { shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 4);
    const r = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", {
        shopId,
        paymentMethod: "PAY_AT_SHOP",
        customerName: "Jane",
        customerPhone: "123",
        items: [
          {
            documentId: docId,
            printType: "PRINT",
            colorMode: "BW",
            paperSize: "A4",
            printSide: "SINGLE",
            pageRange: "ALL",
            copies: 2,
          },
        ],
      })
    );
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("Print order created successfully");
    const order = r.body.data;
    expect(order.orderNumber).toMatch(/^PR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(order.totalPrice).toBe(16);
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.printStatus).toBe("PENDING");
    expect(order.items).toHaveLength(1);
    expect(order.items[0].calculatedPages).toBe(4);
    expect(order.document?.id).toBe(docId);
    expect(order.copies).toBe(2);
    expect(typeof order.publicToken).toBe("string");
    const job = await prisma.printJob.findUnique({
      where: { orderId: order.id },
    });
    expect(job?.status).toBe("QUEUED");
    const payment = await prisma.payment.findUnique({
      where: { orderId: order.id },
    });
    expect(payment?.transactionId).toBe(`CASH-${order.orderNumber}`);
  });

  it("rejects closed shops, cross-shop docs, and bad input", async () => {
    const { token, shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 1);
    await prisma.shop.update({ where: { id: shopId }, data: { isOpen: false } });
    const closed = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", {
        shopId,
        paymentMethod: "PAY_AT_SHOP",
        items: [
          { documentId: docId, colorMode: "BW", paperSize: "A4", printSide: "SINGLE" },
        ],
      })
    );
    expect(closed.status).toBe(400);
    expect(closed.body.message).toBe(
      "Shop is currently closed and not accepting new orders."
    );
    await prisma.shop.update({ where: { id: shopId }, data: { isOpen: true } });

    const other = await makeShopWithOwner();
    const otherDoc = await uploadPdf(other.shopId, 1);
    const cross = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", {
        shopId,
        paymentMethod: "PAY_AT_SHOP",
        items: [
          { documentId: otherDoc, colorMode: "BW", paperSize: "A4", printSide: "SINGLE" },
        ],
      })
    );
    expect(cross.status).toBe(400);
    expect(cross.body.message).toMatch(/does not belong to this shop/);

    const many = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", {
        shopId,
        paymentMethod: "PAY_AT_SHOP",
        items: [
          { documentId: docId, colorMode: "BW", paperSize: "A4", printSide: "SINGLE", copies: 101 },
        ],
      })
    );
    expect(many.status).toBe(400);
    expect(many.body.message).toBe("Copies per item cannot exceed 100");

    const empty = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", { shopId, paymentMethod: "PAY_AT_SHOP", items: [] })
    );
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe("Order must contain at least one document item");
    void token;
  });

  it("reads orders by public token and lists them for admins", async () => {
    const { token, shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 1);
    const created = await json(
      createOrder,
      "/api/public/orders",
      post("/api/public/orders", {
        shopId,
        paymentMethod: "PAY_AT_SHOP",
        items: [
          { documentId: docId, colorMode: "BW", paperSize: "A4", printSide: "SINGLE" },
        ],
      })
    );
    const res = await json(
      getOrder,
      `/api/public/orders/${created.body.data.publicToken}`,
      { method: "GET" },
      { params: { publicToken: created.body.data.publicToken } }
    );
    expect(res.status).toBe(200);
    expect(res.body.data.orderNumber).toBe(created.body.data.orderNumber);
    const missing = await json(
      getOrder,
      "/api/public/orders/00000000-0000-0000-0000-000000000000",
      { method: "GET" },
      { params: { publicToken: "00000000-0000-0000-0000-000000000000" } }
    );
    expect(missing.status).toBe(400);

    const list = await json(listOrders, "/api/admin/orders", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const filtered = await json(
      listOrders,
      "/api/admin/orders?status=PENDING",
      { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    const badFilter = await json(
      listOrders,
      "/api/admin/orders?status=BOGUS",
      { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    expect(badFilter.status).toBe(400);
    expect(badFilter.body.message).toBe("Invalid order status filter: BOGUS");
  });
});
