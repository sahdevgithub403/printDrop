import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@printdrop/db";
import { POST as signup } from "../app/api/auth/signup/route.js";
import { POST as createShop } from "../app/api/admin/shop/create/route.js";
import { POST as publicUpload } from "../app/api/public/documents/upload/route.js";

// Shared integration-test fixtures (isolated test DB only). Test-only
// shops/users/documents with caller-managed cleanup registries.

import { randomUUID } from "node:crypto";

export const RUN = Date.now().toString(36);
// Globally unique across files/workers/runs (timestamp+counter schemes
// collide when workers load in the same millisecond).
export const tag = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;
let seq = 0;

export async function json(
  handler: (r: Request, ctx?: any) => Promise<Response>,
  url: string,
  init: RequestInit,
  ctx?: any
) {
  const res = await handler(new Request(`http://localhost${url}`, init), ctx);
  return { status: res.status, body: (await res.json()) as any };
}

export async function callRaw(
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

export function post(url: string, body: unknown, headers?: Record<string, string>) {
  void url;
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  };
}

export async function pdfBuffer(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`p${i}`, { x: 50, y: 800, font, size: 12 });
  }
  return doc.save();
}

export function multipart(
  fields: Record<string, string>,
  file: { field: string; filename: string; contentType: string; data: Uint8Array }
) {
  const boundary = `----t${RUN}${seq++}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`
    )
  );
  parts.push(Buffer.from(file.data));
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: new Blob([Buffer.concat(parts)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export const emails: string[] = [];
export const shopIds: string[] = [];

export async function makeOwner(): Promise<{ token: string; email: string }> {
  const email = `${tag("owner")}@example.com`;
  emails.push(email);
  const r = await json(signup, "/api/auth/signup", post("/api/auth/signup", {
    name: "Owner",
    email,
    phone: "1",
    password: "password-123",
    confirmPassword: "password-123",
  }));
  if (r.status !== 200) {
    throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
  }
  return { token: r.body.data.token as string, email };
}

export async function makeShopWithOwner(): Promise<{
  token: string;
  shopId: string;
  apiKey: string;
}> {
  const { token } = await makeOwner();
  const r = await json(
    createShop,
    "/api/admin/shop/create",
    post(
      "/api/admin/shop/create",
      { name: `Shop ${tag("s")}` },
      { Authorization: `Bearer ${token}` }
    )
  );
  if (r.status !== 200) {
    throw new Error(`shop create failed: ${JSON.stringify(r.body)}`);
  }
  shopIds.push(r.body.data.id as string);
  return { token, shopId: r.body.data.id as string, apiKey: r.body.data.apiKey as string };
}

export async function uploadPdf(shopId: string, pages = 2): Promise<string> {
  const pdf = await pdfBuffer(pages);
  const { body, contentType } = multipart(
    { shopId },
    { field: "file", filename: "doc.pdf", contentType: "application/pdf", data: pdf }
  );
  const r = await json(publicUpload, "/api/public/documents/upload", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  if (r.status !== 200) {
    throw new Error(`upload failed: ${JSON.stringify(r.body)}`);
  }
  return r.body.data.id as string;
}

export async function cleanupAll() {
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
    const orders = await prisma.printOrder.findMany({
      where: { shopId: { in: shopIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length > 0) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.printOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.document.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopPricing.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    shopIds.length = 0;
  }
}
