import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@printdrop/db";
import {
  makeShopWithOwner,
  makeOwner,
  uploadPdf,
  json,
  callRaw,
  post,
  tag,
  cleanupAll,
} from "./helpers.js";
import { POST as createOrder } from "../app/api/public/orders/route.js";
import { GET as getProfile } from "../app/api/admin/shop/route.js";
import { PUT as updateProfile } from "../app/api/admin/shop/route.js";
import { POST as regenKey } from "../app/api/admin/shop/api-key/regenerate/route.js";
import { GET as shopQr } from "../app/api/admin/shop/qr/route.js";
import { GET as getPricing } from "../app/api/admin/pricing/route.js";
import { PUT as putPricing } from "../app/api/admin/pricing/route.js";
import { PATCH as orderStatus } from "../app/api/admin/orders/[orderId]/status/route.js";
import { PATCH as itemStatus } from "../app/api/admin/orders/[orderId]/items/[itemId]/status/route.js";
import { PATCH as swapDoc } from "../app/api/admin/orders/[orderId]/items/[itemId]/document/route.js";
import { GET as versions } from "../app/api/admin/orders/[orderId]/items/[itemId]/versions/route.js";
import { PATCH as payStatus } from "../app/api/admin/orders/[orderId]/payment-status/route.js";
import { DELETE as deleteOrder } from "../app/api/admin/orders/[orderId]/route.js";
import { GET as listDocs } from "../app/api/admin/documents/route.js";
import { DELETE as deleteDoc } from "../app/api/admin/documents/[documentId]/route.js";
import { DELETE as bulkDelete } from "../app/api/admin/documents/bulk/route.js";
import { DELETE as deleteAll } from "../app/api/admin/documents/all/route.js";
import { GET as jobQueue } from "../app/api/print-agent/jobs/route.js";
import { GET as jobById } from "../app/api/print-agent/jobs/[jobId]/route.js";
import { POST as jobStarted } from "../app/api/print-agent/jobs/[jobId]/started/route.js";
import { POST as jobCompleted } from "../app/api/print-agent/jobs/[jobId]/completed/route.js";
import { POST as jobFailed } from "../app/api/print-agent/jobs/[jobId]/failed/route.js";
import { POST as jobRetry } from "../app/api/print-agent/jobs/[jobId]/retry/route.js";
import { POST as heartbeat } from "../app/api/print-agent/heartbeat/route.js";
import { GET as agentDownload } from "../app/api/print-agent/documents/[documentId]/download/route.js";

// Admin + print-agent integration tests on the isolated test DB.
// Covers shop/pricing CRUD, order lifecycle, item/swap/versions,
// payment transitions, delete guards, document management, and the
// full print-agent job flow (queue -> started -> completed, retry,
// heartbeat, download).

afterEach(cleanupAll);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeOrder(shopId: string, docId: string, copies = 1) {
  const r = await json(
    createOrder,
    "/api/public/orders",
    post("/api/public/orders", {
      shopId,
      paymentMethod: "PAY_AT_SHOP",
      items: [
        { documentId: docId, colorMode: "BW", paperSize: "A4", printSide: "SINGLE", copies },
      ],
    })
  );
  if (r.status !== 200) {
    throw new Error(`order failed: ${JSON.stringify(r.body)}`);
  }
  return r.body.data;
}

describe("admin shop + pricing", () => {
  it("reads/updates profile, rotates keys once, serves QR + pricing", async () => {
    const { token, shopId, apiKey } = await makeShopWithOwner();
    expect(apiKey).toMatch(/^pa_live_[0-9a-f]{32}$/);

    const profile = await json(getProfile, "/api/admin/shop", {
      method: "GET",
      headers: auth(token),
    });
    expect(profile.status).toBe(200);
    expect(profile.body.data.apiKey).toBeNull();
    expect(profile.body.data.isOpen).toBe(true);
    const shopSlug = profile.body.data.slug as string;

    const updated = await json(
      updateProfile,
      "/api/admin/shop",
      post("/api/admin/shop", { isOpen: false, name: "Renamed" }, auth(token))
    );
    expect(updated.status).toBe(200);
    expect(updated.body.message).toBe("Shop profile updated successfully");
    expect(updated.body.data.isOpen).toBe(false);
    expect(updated.body.data.apiKey).toBeNull();

    const rotated = await json(regenKey, "/api/admin/shop/api-key/regenerate", {
      method: "POST",
      headers: auth(token),
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.apiKey).toMatch(/^pa_live_/);
    expect(rotated.body.data.apiKey).not.toBe(apiKey);

    const qr = await json(shopQr, "/api/admin/shop/qr", {
      method: "GET",
      headers: auth(token),
    });
    expect(qr.body.data.shopUrl).toMatch(/^\/shop\//);
    expect(qr.body.data.fullShopUrl).toContain("/shop/");
    expect(qr.body.data.fullShopUrl).toMatch(/^http:\/\/localhost:3000\/shop\//);

    process.env["APP_CUSTOMER_URL"] = "https://shop.example.com";
    const qrEnv = await json(shopQr, "/api/admin/shop/qr", {
      method: "GET",
      headers: auth(token),
    });
    expect(qrEnv.body.data.fullShopUrl).toBe(
      `https://shop.example.com/shop/${shopSlug}`
    );
    delete process.env["APP_CUSTOMER_URL"];

    const pricing = await json(getPricing, "/api/admin/pricing", {
      method: "GET",
      headers: auth(token),
    });
    expect(pricing.body.data.bwA4Single).toBe(2);
    expect(pricing.body.data.passportPrice).toBe(50);

    const put = await json(
      putPricing,
      "/api/admin/pricing",
      post("/api/admin/pricing", { bwA4Single: 2.5 }, auth(token))
    );
    expect(put.status).toBe(200);
    expect(put.body.message).toBe("Pricing updated successfully");
    expect(put.body.data.bwA4Single).toBe(2.5);

    const neg = await json(
      putPricing,
      "/api/admin/pricing",
      post("/api/admin/pricing", { bwA4Single: -1 }, auth(token))
    );
    expect(neg.status).toBe(400);
    expect(neg.body.message).toBe("Pricing field 'bwA4Single' must not be negative");
    void shopId;
  });

  it("404s shop-less profiles (setup state, never 500)", async () => {
    const { token } = await makeOwner();
    const r = await json(getProfile, "/api/admin/shop", {
      method: "GET",
      headers: auth(token),
    });
    expect(r.status).toBe(404);
  });
});

describe("admin order lifecycle", () => {
  it("transitions statuses, derives item states, and guards deletes", async () => {
    const { token, shopId } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 3);
    const order = await makeOrder(shopId, docId);
    const itemId = order.items[0].id as string;

    const printing = await json(
      orderStatus,
      `/api/admin/orders/${order.id}/status`,
      post(`/api/admin/orders/${order.id}/status`, { printStatus: "PRINTING" }, auth(token)),
      { params: { orderId: order.id } }
    );
    expect(printing.status).toBe(200);
    expect(printing.body.message).toBe("Order status updated");
    expect(printing.body.data.printStatus).toBe("PRINTING");
    expect(printing.body.data.items[0].printStatus).toBe("PRINTING");

    const bad = await json(
      orderStatus,
      `/api/admin/orders/${order.id}/status`,
      post(`/api/admin/orders/${order.id}/status`, { printStatus: "PENDING" }, auth(token)),
      { params: { orderId: order.id } }
    );
    expect(bad.status).toBe(400);

    const done = await json(
      itemStatus,
      `/api/admin/orders/${order.id}/items/${itemId}/status`,
      post(`/api/admin/orders/${order.id}/items/${itemId}/status`, { printStatus: "COMPLETED" }, auth(token)),
      { params: { orderId: order.id, itemId } }
    );
    expect(done.body.message).toBe("Item print status updated");
    expect(done.body.data.printStatus).toBe("COMPLETED");

    // Cross-shop isolation: another shop's admin gets 403.
    const other = await makeShopWithOwner();
    const cross = await json(
      orderStatus,
      `/api/admin/orders/${order.id}/status`,
      post(`/api/admin/orders/${order.id}/status`, { printStatus: "FAILED" }, auth(other.token)),
      { params: { orderId: order.id } }
    );
    expect(cross.status).toBe(403);

    // PRINTING orders cannot be deleted; COMPLETED needs confirm.
    const delPrinting = await json(
      deleteOrder,
      `/api/admin/orders/${order.id}`,
      { method: "DELETE", headers: auth(token) },
      { params: { orderId: order.id } }
    );
    expect(delPrinting.status).toBe(409);
    const delDone = await json(
      deleteOrder,
      `/api/admin/orders/${order.id}`,
      { method: "DELETE", headers: auth(token) },
      { params: { orderId: order.id } }
    );
    expect(delDone.status).toBe(409);
    expect(delDone.body.message).toMatch(/confirm=true/);
  });

  it("swaps documents with reprice, lists versions, updates payment", async () => {
    const { token, shopId } = await makeShopWithOwner();
    const docA = await uploadPdf(shopId, 2);
    const docB = await uploadPdf(shopId, 5);
    const order = await makeOrder(shopId, docA);
    const itemId = order.items[0].id as string;

    const swapped = await json(
      swapDoc,
      `/api/admin/orders/${order.id}/items/${itemId}/document`,
      post(`/api/admin/orders/${order.id}/items/${itemId}/document`, { documentId: docB }, auth(token)),
      { params: { orderId: order.id, itemId } }
    );
    expect(swapped.status).toBe(200);
    expect(swapped.body.data.items[0].document.id).toBe(docB);
    expect(swapped.body.data.items[0].calculatedPages).toBe(5);

    const vers = await json(
      versions,
      `/api/admin/orders/${order.id}/items/${itemId}/versions`,
      { method: "GET", headers: auth(token) },
      { params: { orderId: order.id, itemId } }
    );
    expect(vers.status).toBe(200);
    expect(vers.body.data.map((d: any) => d.id)).toContain(docB);

    const paid = await json(
      payStatus,
      `/api/admin/orders/${order.id}/payment-status`,
      post(`/api/admin/orders/${order.id}/payment-status`, { paymentStatus: "PAID" }, auth(token)),
      { params: { orderId: order.id } }
    );
    expect(paid.status).toBe(200);
    expect(paid.body.data.paymentStatus).toBe("PAID");
    expect(
      await prisma.printJob.findUnique({ where: { orderId: order.id } })
    ).not.toBeNull();

    const locked = await json(
      swapDoc,
      `/api/admin/orders/${order.id}/items/${itemId}/document`,
      post(`/api/admin/orders/${order.id}/items/${itemId}/document`, { documentId: docA }, auth(token)),
      { params: { orderId: order.id, itemId } }
    );
    expect(locked.status).toBe(409);

    const delPaid = await json(
      deleteOrder,
      `/api/admin/orders/${order.id}`,
      { method: "DELETE", headers: auth(token) },
      { params: { orderId: order.id } }
    );
    expect(delPaid.status).toBe(409);
  });
});

describe("admin documents + print-agent flow", () => {
  it("lists/filters/deletes documents and drives jobs to completion", async () => {
    const { token, shopId, apiKey } = await makeShopWithOwner();
    const docId = await uploadPdf(shopId, 2);
    const order = await makeOrder(shopId, docId);
    const agent = { "X-Agent-Key": apiKey };

    const listed = await json(listDocs, "/api/admin/documents", {
      method: "GET",
      headers: auth(token),
    });
    expect(listed.status).toBe(200);
    expect(listed.body.data.totalElements).toBe(1);
    expect(listed.body.data.content[0].canDelete).toBe(false);

    const queue = await json(jobQueue, "/api/print-agent/jobs", {
      method: "GET",
      headers: agent,
    });
    expect(queue.status).toBe(200);
    expect(queue.body.data).toHaveLength(1);
    const jobId = queue.body.data[0].jobId as string;

    const started = await json(
      jobStarted,
      `/api/print-agent/jobs/${jobId}/started`,
      post(`/api/print-agent/jobs/${jobId}/started`, { agentId: "Agent-1" }, agent),
      { params: { jobId } }
    );
    expect(started.status).toBe(200);
    expect(started.body.message).toBe("Print job started");
    expect(started.body.data.status).toBe("PROCESSING");
    expect(started.body.data.assignedAgentId).toBe("Agent-1");

    const lb = await callRaw(
      agentDownload,
      `/api/print-agent/documents/${docId}/download`,
      { method: "GET", headers: agent },
      { params: { documentId: docId } }
    );
    expect(lb.status).toBe(200);
    expect(lb.headers.get("content-type")).toBe("application/pdf");

    const completed = await json(
      jobCompleted,
      `/api/print-agent/jobs/${jobId}/completed`,
      post(`/api/print-agent/jobs/${jobId}/completed`, {}, agent),
      { params: { jobId } }
    );
    expect(completed.body.data.status).toBe("COMPLETED");
    expect(completed.body.data.order.printStatus).toBe("COMPLETED");

    const retryTerminal = await json(
      jobRetry,
      `/api/print-agent/jobs/${jobId}/retry`,
      post(`/api/print-agent/jobs/${jobId}/retry`, {}, agent),
      { params: { jobId } }
    );
    expect(retryTerminal.status).toBe(400);

    const failed = await json(
      jobFailed,
      `/api/print-agent/jobs/${jobId}/failed`,
      post(`/api/print-agent/jobs/${jobId}/failed`, {}, agent),
      { params: { jobId } }
    );
    expect(failed.status).toBe(400);

    const hb = await json(heartbeat, "/api/print-agent/heartbeat", {
      method: "POST",
      headers: agent,
    });
    expect(hb.status).toBe(200);
    expect(hb.body.data.sessionValid).toBe(true);

    const hbAnon = await json(heartbeat, "/api/print-agent/heartbeat", {
      method: "POST",
    });
    expect(hbAnon.status).toBe(401);

    const detail = await json(
      jobById,
      `/api/print-agent/jobs/${jobId}`,
      { method: "GET", headers: agent },
      { params: { jobId } }
    );
    expect(detail.status).toBe(200);

    // Completed order deletes with confirm; then the doc row is an
    // orphan and bulk-deletes cleanly.
    const del = await json(
      deleteOrder,
      `/api/admin/orders/${order.id}?confirm=true`,
      { method: "DELETE", headers: auth(token) },
      { params: { orderId: order.id } }
    );
    expect(del.status).toBe(200);

    const bulk = await json(
      bulkDelete,
      "/api/admin/documents/bulk",
      post("/api/admin/documents/bulk", { documentIds: [docId] }, auth(token))
    );
    expect(bulk.body.data.deletedCount).toBe(1);

    const all = await json(deleteAll, "/api/admin/documents/all", {
      method: "DELETE",
      headers: auth(token),
    });
    expect(all.body.data.totalCandidateDocuments).toBe(0);

    // Single delete: active refs 400, orphans 200.
    const doc2 = await uploadPdf(shopId, 1);
    const order2 = await makeOrder(shopId, doc2);
    const activeDel = await json(
      deleteDoc,
      `/api/admin/documents/${doc2}`,
      { method: "DELETE", headers: auth(token) },
      { params: { documentId: doc2 } }
    );
    expect(activeDel.status).toBe(400);
    await json(
      deleteOrder,
      `/api/admin/orders/${order2.id}`,
      { method: "DELETE", headers: auth(token) },
      { params: { orderId: order2.id } }
    );
    const orphanDel = await json(
      deleteDoc,
      `/api/admin/documents/${doc2}`,
      { method: "DELETE", headers: auth(token) },
      { params: { documentId: doc2 } }
    );
    expect(orphanDel.status).toBe(200);
    expect(orphanDel.body.message).toBe("Document permanently deleted");

    // FAILED job retry requeues; completed terminal stays terminal.
    const doc3 = await uploadPdf(shopId, 1);
    const order3 = await makeOrder(shopId, doc3);
    const q2 = await json(jobQueue, "/api/print-agent/jobs", {
      method: "GET",
      headers: agent,
    });
    const job3 = q2.body.data.find((j: any) => j.order.id === order3.id).jobId as string;
    await json(
      jobFailed,
      `/api/print-agent/jobs/${job3}/failed`,
      post(`/api/print-agent/jobs/${job3}/failed`, {}, agent),
      { params: { jobId: job3 } }
    );
    const retried = await json(
      jobRetry,
      `/api/print-agent/jobs/${job3}/retry`,
      post(`/api/print-agent/jobs/${job3}/retry`, {}, agent),
      { params: { jobId: job3 } }
    );
    expect(retried.body.message).toBe("Print job requeued");
    expect(retried.body.data.status).toBe("QUEUED");
  });
});
