import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@printdrop/db";
import { hashPassword } from "@printdrop/domain";
import { POST as signup } from "../app/api/auth/signup/route.js";
import { POST as login } from "../app/api/auth/login/route.js";
import { POST as publicUpload } from "../app/api/public/documents/upload/route.js";
import { POST as adminUpload } from "../app/api/admin/documents/upload/route.js";
import { GET as adminDownload } from "../app/api/admin/documents/[documentId]/download/route.js";
import { GET as agentDownload } from "../app/api/print-agent/documents/[documentId]/download/route.js";
import { getStorage, resetStorage } from "../lib/documentRoutes.js";

// Phase 2B.4 integration tests — document upload/download against the
// ISOLATED test database (printdrop_dev @5434) and an isolated LOCAL
// bucket directory (the R2 adapter is implemented but UNCONNECTED — no
// credentials exist, so no R2 test is faked; see phase report).
// Test-only shops/users/documents; full cleanup after each case.

const tag = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;
let bucketDir = "";

function pdfBuffer(pages: number): Promise<Uint8Array> {
  return PDFDocument.create().then(async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) {
      const page = doc.addPage([595, 842]);
      page.drawText(`p${i}`, { x: 50, y: 800, font, size: 12 });
    }
    return doc.save();
  });
}

function multipart(
  fields: Record<string, string>,
  files: Array<{ field: string; filename: string; contentType: string; data: Uint8Array }>
): { body: BodyInit; contentType: string } {
  const boundary = `----test${randomUUID().slice(0, 8)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.contentType}\r\n\r\n`
      )
    );
    parts.push(Buffer.from(f.data));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: new Blob([Buffer.concat(parts)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function call(
  handler: (r: Request, ctx?: any) => Promise<Response>,
  url: string,
  init: RequestInit,
  ctx?: any
) {
  const res = await handler(new Request(`http://localhost${url}`, init), ctx);
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json")
    ? await res.json()
    : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, data: data as any };
}

async function makeUser(email: string, password: string, role = "ROLE_SHOP_ADMIN") {
  if (role === "ROLE_SHOP_ADMIN") {
    const r = await call(signup, "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "T",
        email,
        phone: "1",
        password,
        confirmPassword: password,
      }),
    });
    if (r.status !== 200) {
      throw new Error(`signup failed: ${JSON.stringify(r.data)}`);
    }
    return r.data.data.token as string;
  }
  await prisma.user.create({
    data: {
      email,
      password: await hashPassword(password),
      name: "S",
      role,
      createdAt: new Date(),
    },
  });
  const r = await call(login, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return r.data.data.token as string;
}

async function makeShop(slug: string) {
  return prisma.shop.create({
    data: {
      name: "S",
      slug,
      isOpen: true,
      apiKey: `pa_live_test_${slug.replace(/-/g, "")}`,
      createdAt: new Date(),
    },
  });
}

const emails: string[] = [];
const shopIds: string[] = [];
const docIds: string[] = [];

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    emails.length = 0;
  }
  if (shopIds.length > 0) {
    const docs = await prisma.document.findMany({
      where: { shopId: { in: shopIds } },
      select: { id: true },
    });
    for (const d of docs) {
      if (!docIds.includes(d.id)) {
        docIds.push(d.id);
      }
    }
  }
  if (docIds.length > 0) {
    const orders = await prisma.printOrder.findMany({
      where: {
        OR: [
          { items: { some: { documentId: { in: docIds } } } },
          { documentId: { in: docIds } },
        ],
      },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length > 0) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.printOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.document.deleteMany({ where: { id: { in: docIds } } });
    docIds.length = 0;
  }
  if (shopIds.length > 0) {
    await prisma.shopPricing.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    shopIds.length = 0;
  }
}

beforeEach(() => {
  bucketDir = mkdtempSync(join(tmpdir(), "printdrop-docs-test-"));
  process.env["FILE_STORAGE_DIR"] = bucketDir;
  resetStorage();
  expect(getStorage().backend).toBe("local-directory");
});

afterEach(async () => {
  await cleanup();
  delete process.env["FILE_STORAGE_DIR"];
  resetStorage();
  try {
    rmSync(bucketDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

afterAll(async () => {
  // NOTE: no global row-count assertion here — test files run in parallel
  // workers against shared tables, so a global zero-count would race other
  // files' in-flight rows. Isolation is enforced per-test via the tracked
  // registries above (emails/shopIds/docIds), which are always drained.
  // A manual zero-row check runs after the suite in the phase report.
});

describe("POST /api/public/documents/upload", () => {
  it("stores PDFs with shopSlug binding and exact DTO", async () => {
    const shop = await makeShop(tag("shop"));
    shopIds.push(shop.id);
    const pdf = await pdfBuffer(2);
    const { body, contentType } = multipart(
      { shopSlug: shop.slug },
      [{ field: "file", filename: "notes.pdf", contentType: "application/pdf", data: pdf }]
    );
    const r = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    expect(r.status).toBe(200);
    expect(r.data.message).toBe("Document uploaded successfully");
    expect(r.data.data).toMatchObject({
      originalFileName: "notes.pdf",
      contentType: "application/pdf",
      fileSize: pdf.length,
      pageCount: 2,
    });
    const row = await prisma.document.findUnique({
      where: { id: r.data.data.id },
    });
    expect(row?.shopId).toBe(shop.id);
    expect(row?.storedFileName).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(readdirSync(bucketDir)).toHaveLength(1);
  });

  it("binds explicit shopId and rejects bad UUIDs; unknown slugs stay unbound", async () => {
    const shop = await makeShop(tag("shop"));
    shopIds.push(shop.id);
    const pdf = await pdfBuffer(1);
    const byId = multipart(
      { shopId: shop.id },
      [{ field: "file", filename: "a.pdf", contentType: "application/pdf", data: pdf }]
    );
    const r1 = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": byId.contentType },
      body: byId.body,
    });
    expect(r1.status).toBe(200);
    expect(
      (await prisma.document.findUnique({ where: { id: r1.data.data.id } }))?.shopId
    ).toBe(shop.id);

    const bad = multipart(
      { shopId: "nope" },
      [{ field: "file", filename: "a.pdf", contentType: "application/pdf", data: pdf }]
    );
    expect(
      (
        await call(publicUpload, "/api/public/documents/upload", {
          method: "POST",
          headers: { "Content-Type": bad.contentType },
          body: bad.body,
        })
      ).status
    ).toBe(400);

    const ghost = multipart(
      { shopSlug: `ghost-${randomUUID().slice(0, 8)}` },
      [{ field: "file", filename: "a.pdf", contentType: "application/pdf", data: pdf }]
    );
    const r3 = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": ghost.contentType },
      body: ghost.body,
    });
    expect(r3.status).toBe(200);
    docIds.push(r3.data.data.id as string);
    expect(
      (await prisma.document.findUnique({ where: { id: r3.data.data.id } }))?.shopId
    ).toBeNull();
  });

  it("rejects bad types, corrupt bytes, missing and oversized files", async () => {
    const pdf = await pdfBuffer(1);
    const exe = multipart(
      {},
      [{ field: "file", filename: "run.exe", contentType: "application/octet-stream", data: pdf }]
    );
    const r1 = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": exe.contentType },
      body: exe.body,
    });
    expect(r1.status).toBe(400);
    expect(r1.data.message).toBe(
      "Unsupported file type: .exe. Allowed formats: PDF, JPG, PNG, DOC, DOCX."
    );

    const fake = multipart(
      {},
      [{ field: "file", filename: "fake.pdf", contentType: "application/pdf", data: new TextEncoder().encode("hello world, not pdf") }]
    );
    const r2 = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": fake.contentType },
      body: fake.body,
    });
    expect(r2.status).toBe(400);
    expect(r2.data.message).toBe("Invalid or corrupted PDF file: fake.pdf");

    const empty = multipart({}, []);
    const r3 = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": empty.contentType },
      body: empty.body,
    });
    expect(r3.status).toBe(400);
    expect(r3.data.message).toBe("Missing required parameter: file");

    const big = multipart(
      {},
      [{ field: "file", filename: "big.pdf", contentType: "application/pdf", data: new Uint8Array(21 * 1024 * 1024) }]
    );
    const r4 = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": big.contentType },
      body: big.body,
    });
    expect(r4.status).toBe(400);
    expect(r4.data.message).toBe("The file exceeds the maximum allowed size of 20 MB.");
    expect(readdirSync(bucketDir)).toHaveLength(0);
  });
});

describe("admin edited-copy upload + authorized downloads", () => {
  async function ownedFixture() {
    const email = tag("owner") + "@example.com";
    emails.push(email);
    const token = await makeUser(email, "password-123");
    const shop = await makeShop(tag("shop"));
    shopIds.push(shop.id);
    await prisma.user.update({
      where: { email },
      data: { shopId: shop.id },
    });
    const pdf = await pdfBuffer(1);
    const up = multipart(
      { shopId: shop.id },
      [{ field: "file", filename: "src.pdf", contentType: "application/pdf", data: pdf }]
    );
    const r = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": up.contentType },
      body: up.body,
    });
    const docId = r.data.data.id as string;
    const order = await prisma.printOrder.create({
      data: {
        orderNumber: `PR-${randomUUID().slice(0, 6).toUpperCase()}`,
        publicToken: randomUUID(),
        shopId: shop.id,
        totalPrice: "10.00",
        paymentMethod: "PAY_AT_SHOP",
        paymentStatus: "PENDING",
        printStatus: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        documentId: docId,
        printType: "PRINT",
        colorMode: "BW",
        paperSize: "A4",
        printSide: "SINGLE",
        pageRange: "ALL",
        copies: 1,
        calculatedPages: 1,
        unitPrice: "2.00",
        itemPrice: "2.00",
        printStatus: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { token, shop, docId, pdf };
  }

  it("saves edited copies with lineage and gates source access", async () => {
    const { token, docId } = await ownedFixture();
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
      0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8,
    ]);
    const body = multipart(
      { sourceDocumentId: docId },
      [{ field: "file", filename: "edit.png", contentType: "image/png", data: png }]
    );
    const r = await call(adminUpload, "/api/admin/documents/upload", {
      method: "POST",
      headers: {
        "Content-Type": body.contentType,
        Authorization: `Bearer ${token}`,
      },
      body: body.body,
    });
    expect(r.status).toBe(200);
    expect(r.data.message).toBe("Edited copy saved");
    expect(r.data.data).toMatchObject({
      originalFileName: "edit.png",
      orderNumber: "N/A",
      customerName: "Walk-in",
      orderPrintStatus: "PENDING",
      canDelete: true,
      isProcessing: false,
      parentDocumentId: docId,
    });

    const foreign = multipart(
      { sourceDocumentId: "11111111-1111-1111-1111-111111111111" },
      [{ field: "file", filename: "edit.png", contentType: "image/png", data: png }]
    );
    const r2 = await call(adminUpload, "/api/admin/documents/upload", {
      method: "POST",
      headers: {
        "Content-Type": foreign.contentType,
        Authorization: `Bearer ${token}`,
      },
      body: foreign.body,
    });
    expect(r2.status).toBe(403);

    const anon = multipart(
      {},
      [{ field: "file", filename: "edit.png", contentType: "image/png", data: png }]
    );
    expect(
      (
        await call(adminUpload, "/api/admin/documents/upload", {
          method: "POST",
          headers: { "Content-Type": anon.contentType },
          body: anon.body,
        })
      ).status
    ).toBe(401);
  });

  it("serves owned downloads with legacy headers; 403s cross-shop/orphan/unknown", async () => {
    const { token, shop, docId, pdf } = await ownedFixture();
    const dl = await call(
      adminDownload,
      `/api/admin/documents/${docId}/download`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      { params: { documentId: docId } }
    );
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toBe(
      'attachment; filename="src.pdf"; filename*=UTF-8\'\'src.pdf'
    );
    expect(Buffer.from(dl.data as Uint8Array).equals(Buffer.from(pdf))).toBe(true);

    const otherEmail = tag("other") + "@example.com";
    emails.push(otherEmail);
    const otherToken = await makeUser(otherEmail, "password-123");
    // A shop-less user gets the legacy missing-context 403 (Spring checks
    // the principal's shop binding before ownership), so bind the user to
    // a DIFFERENT shop to exercise the true cross-shop ownership 403.
    const otherShop = await makeShop(tag("othershop"));
    shopIds.push(otherShop.id);
    await prisma.user.update({
      where: { email: otherEmail },
      data: { shopId: otherShop.id },
    });
    const cross = await call(
      adminDownload,
      `/api/admin/documents/${docId}/download`,
      { method: "GET", headers: { Authorization: `Bearer ${otherToken}` } },
      { params: { documentId: docId } }
    );
    expect(cross.status).toBe(403);
    expect((cross.data as any).message).toBe(
      "Document does not belong to any orders in your shop"
    );

    const ghost = await call(
      adminDownload,
      `/api/admin/documents/22222222-2222-2222-2222-222222222222/download`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      { params: { documentId: "22222222-2222-2222-2222-222222222222" } }
    );
    expect(ghost.status).toBe(403);

    // Orphan row (upload-bound, never ordered) is NOT downloadable.
    const orphanUp = multipart(
      { shopId: shop.id },
      [{ field: "file", filename: "orph.pdf", contentType: "application/pdf", data: pdf }]
    );
    const orphanRes = await call(publicUpload, "/api/public/documents/upload", {
      method: "POST",
      headers: { "Content-Type": orphanUp.contentType },
      body: orphanUp.body,
    });
    const orphanDl = await call(
      adminDownload,
      `/api/admin/documents/${orphanRes.data.data.id}/download`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      { params: { documentId: orphanRes.data.data.id } }
    );
    expect(orphanDl.status).toBe(403);

    // Row exists with order ownership but bytes are gone -> legacy 500.
    const ghostRow = await prisma.document.create({
      data: {
        originalFileName: "gone.pdf",
        storedFileName: `${randomUUID()}.pdf`,
        contentType: "application/pdf",
        fileSize: BigInt(10),
        pageCount: 1,
        filePath: "gone.pdf",
        shopId: shop.id,
        uploadedAt: new Date(),
      },
    });
    docIds.push(ghostRow.id);
    const ghostOrder = await prisma.printOrder.create({
      data: {
        orderNumber: `PR-${randomUUID().slice(0, 6).toUpperCase()}`,
        publicToken: randomUUID(),
        shopId: shop.id,
        totalPrice: "10.00",
        paymentMethod: "PAY_AT_SHOP",
        paymentStatus: "PENDING",
        printStatus: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: ghostOrder.id,
        documentId: ghostRow.id,
        printType: "PRINT",
        colorMode: "BW",
        paperSize: "A4",
        printSide: "SINGLE",
        pageRange: "ALL",
        copies: 1,
        calculatedPages: 1,
        unitPrice: "2.00",
        itemPrice: "2.00",
        printStatus: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const gone = await call(
      adminDownload,
      `/api/admin/documents/${ghostRow.id}/download`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      { params: { documentId: ghostRow.id } }
    );
    expect(gone.status).toBe(500);
    expect((gone.data as any).message).toBe(
      "An internal server error occurred"
    );

    // Super-admin bypasses per-shop ownership.
    const superEmail = tag("super") + "@example.com";
    emails.push(superEmail);
    const superToken = await makeUser(superEmail, "password-123", "ROLE_SUPER_ADMIN");
    const superDl = await call(
      adminDownload,
      `/api/admin/documents/${docId}/download`,
      { method: "GET", headers: { Authorization: `Bearer ${superToken}` } },
      { params: { documentId: docId } }
    );
    expect(superDl.status).toBe(200);
  });

  it("serves print-agent downloads by API key with the same rules", async () => {
    const { shop, docId, pdf } = await ownedFixture();
    const key = (await prisma.shop.findUnique({ where: { id: shop.id } }))!.apiKey!;
    const dl = await call(
      agentDownload,
      `/api/print-agent/documents/${docId}/download`,
      { method: "GET", headers: { "X-Agent-Key": key } },
      { params: { documentId: docId } }
    );
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.data as Uint8Array).equals(Buffer.from(pdf))).toBe(true);

    const anon = await call(
      agentDownload,
      `/api/print-agent/documents/${docId}/download`,
      { method: "GET", headers: { "X-Agent-Key": "pa_live_wrong" } },
      { params: { documentId: docId } }
    );
    expect(anon.status).toBe(401);

    const other = await makeShop(tag("othershop"));
    shopIds.push(other.id);
    const otherKey = (await prisma.shop.findUnique({ where: { id: other.id } }))!.apiKey!;
    const cross = await call(
      agentDownload,
      `/api/print-agent/documents/${docId}/download`,
      { method: "GET", headers: { "X-Agent-Key": otherKey } },
      { params: { documentId: docId } }
    );
    expect(cross.status).toBe(403);
  });

  it("rejects PRINT_AGENT JWTs on admin document routes by role", async () => {
    const { shop, docId } = await ownedFixture();
    const agentEmail = tag("agent") + "@example.com";
    emails.push(agentEmail);
    const agentToken = await makeUser(agentEmail, "password-123", "ROLE_PRINT_AGENT");
    await prisma.user.update({
      where: { email: agentEmail },
      data: { shopId: shop.id },
    });

    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
      0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8,
    ]);
    const up = multipart(
      {},
      [{ field: "file", filename: "a.png", contentType: "image/png", data: png }]
    );
    const deniedUpload = await call(adminUpload, "/api/admin/documents/upload", {
      method: "POST",
      headers: {
        "Content-Type": up.contentType,
        Authorization: `Bearer ${agentToken}`,
      },
      body: up.body,
    });
    expect(deniedUpload.status).toBe(403);

    const deniedDownload = await call(
      adminDownload,
      `/api/admin/documents/${docId}/download`,
      { method: "GET", headers: { Authorization: `Bearer ${agentToken}` } },
      { params: { documentId: docId } }
    );
    expect(deniedDownload.status).toBe(403);
  });
});
