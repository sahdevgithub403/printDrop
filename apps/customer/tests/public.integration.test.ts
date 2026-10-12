import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@printdrop/db";
import { GET as getShop } from "../app/api/public/shops/[slug]/route.js";
import { POST as calculate } from "../app/api/public/pricing/calculate/route.js";

// Phase 2B.3 integration tests — public shop/pricing reads against the
// ISOLATED test database only (printdrop_dev on localhost:5434; tables
// created once by the approved Phase 2B.2 test setup — no db push,
// migration, or seed here). Test-only shop/pricing/document rows with
// per-test cleanup. No production contact.

import { randomUUID } from "node:crypto";

const uniq = () => randomUUID().slice(0, 8);
const slug = (tag: string) => `phase23-${tag}-${uniq()}`;

async function postJson(
  handler: (r: Request) => Promise<Response>,
  path: string,
  rawBody: string
) {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    })
  );
  return { status: res.status, json: (await res.json()) as any };
}

async function createShop(input?: {
  isOpen?: boolean | null;
  apiKey?: string | null;
}) {
  const tag = slug("shop");
  return prisma.shop.create({
    data: {
      name: "Test Shop",
      slug: tag,
      address: "1 Test Lane",
      phone: "9999999999",
      logoUrl: null,
      ownerName: "Owner",
      city: "TC",
      state: "TS",
      pincode: "000000",
      isOpen: input?.isOpen ?? true,
      apiKey: input?.apiKey ?? `pa_live_test_${tag.replace(/-/g, "")}`,
      createdAt: new Date(),
    },
  });
}

async function createPricing(shopId: string, overrides?: Record<string, string>) {
  return prisma.shopPricing.create({
    data: {
      shopId,
      bwA4Single: overrides?.["bwA4Single"] ?? "2.00",
      bwA4Double: overrides?.["bwA4Double"] ?? "3.00",
      colorA4Single: overrides?.["colorA4Single"] ?? "10.00",
      colorA4Double: overrides?.["colorA4Double"] ?? "15.00",
      bwA3Single: overrides?.["bwA3Single"] ?? "5.00",
      bwA3Double: overrides?.["bwA3Double"] ?? "8.00",
      colorA3Single: overrides?.["colorA3Single"] ?? "20.00",
      colorA3Double: overrides?.["colorA3Double"] ?? "35.00",
      passportPrice: overrides?.["passportPrice"] ?? "50.00",
    },
  });
}

async function createDocument(pageCount: number) {
  const tag = `doc-${uniq()}`;
  return prisma.document.create({
    data: {
      originalFileName: `${tag}.pdf`,
      storedFileName: `${tag}-stored.pdf`,
      contentType: "application/pdf",
      fileSize: BigInt(1024),
      pageCount,
      filePath: `${tag}-stored.pdf`,
      shopId: null,
      parentDocumentId: null,
      uploadedAt: new Date(),
    },
  });
}

const shopIds: string[] = [];
const docIds: string[] = [];

async function cleanup() {
  if (docIds.length > 0) {
    await prisma.document.deleteMany({ where: { id: { in: docIds } } });
    docIds.length = 0;
  }
  if (shopIds.length > 0) {
    await prisma.shopPricing.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    shopIds.length = 0;
  }
}

afterEach(async () => {
  await cleanup();
});

describe("GET /api/public/shops/:slug (PublicShopController)", () => {
  it("returns the shop DTO with apiKey nulled", async () => {
    const shop = await createShop();
    shopIds.push(shop.id);
    const res = await getShop({} as Request, { params: { slug: shop.slug } });
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe("Success");
    expect(json.data).toMatchObject({
      id: shop.id,
      name: "Test Shop",
      slug: shop.slug,
      address: "1 Test Lane",
      phone: "9999999999",
      apiKey: null,
      ownerName: "Owner",
      city: "TC",
      state: "TS",
      pincode: "000000",
      isOpen: true,
    });
  });

  it("400s unknown slugs with the legacy message (not 404)", async () => {
    const missing = `no-such-${uniq()}`;
    const res = await getShop({} as Request, { params: { slug: missing } });
    const json = (await res.json()) as any;
    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      message: `Shop not found with slug: ${missing}`,
      data: null,
    });
  });

  it("returns closed shops as-is and maps null isOpen to true", async () => {
    const closed = await createShop({ isOpen: false });
    shopIds.push(closed.id);
    const resClosed = await getShop({} as Request, {
      params: { slug: closed.slug },
    });
    expect(((await resClosed.json()) as any).data.isOpen).toBe(false);

    const tag = slug("nullopen");
    const nulled = await prisma.shop.create({
      data: {
        name: "N",
        slug: tag,
        isOpen: null,
        apiKey: `pa_live_test_${tag.replace(/-/g, "")}`,
        createdAt: new Date(),
      },
    });
    shopIds.push(nulled.id);
    const resNull = await getShop({} as Request, { params: { slug: tag } });
    expect(((await resNull.json()) as any).data.isOpen).toBe(true);
  });
});

describe("POST /api/public/pricing/calculate (PublicPricingController)", () => {
  it("prices BW/A4/SINGLE with exact totals and breakdown", async () => {
    const shop = await createShop();
    shopIds.push(shop.id);
    await createPricing(shop.id);
    const doc = await createDocument(10);
    docIds.push(doc.id);
    const { status, json } = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      JSON.stringify({
        shopId: shop.id,
        documentId: doc.id,
        printType: "PRINT",
        colorMode: "BW",
        paperSize: "A4",
        printSide: "SINGLE",
        pageRange: "ALL",
        copies: 2,
      })
    );
    expect(status).toBe(200);
    expect(json.message).toBe("Success");
    expect(json.data).toMatchObject({
      totalDocumentPages: 10,
      calculatedPages: 10,
      copies: 2,
      unitPricePerPage: 2,
      totalPrice: 40,
      breakdown: "10 Pages × ₹2.00 × 2 Copies = ₹40.00 (B&W • A4 • Single Side • PRINT)",
    });
  });

  it("charges DOUBLE by sheets, PASSPORT_PHOTO by passport price", async () => {
    const shop = await createShop();
    shopIds.push(shop.id);
    await createPricing(shop.id);
    const doc = await createDocument(10);
    docIds.push(doc.id);
    const dbl = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      JSON.stringify({
        shopId: shop.id,
        documentId: doc.id,
        printType: "XEROX",
        colorMode: "BW",
        paperSize: "A4",
        printSide: "DOUBLE",
        copies: 1,
      })
    );
    expect(dbl.json.data).toMatchObject({
      calculatedPages: 10,
      totalPrice: 15,
      breakdown:
        "5 Sheets × ₹3.00 × 1 Copies = ₹15.00 (B&W • A4 • Double Side • XEROX)",
    });

    const photo = await createDocument(1);
    docIds.push(photo.id);
    const pp = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      JSON.stringify({
        shopId: shop.id,
        documentId: photo.id,
        printType: "PASSPORT_PHOTO",
        colorMode: "COLOR",
        paperSize: "A4",
        printSide: "SINGLE",
        copies: 1,
      })
    );
    expect(pp.json.data).toMatchObject({
      totalPrice: 50,
      breakdown:
        "1 Pages × ₹50.00 × 1 Copies = ₹50.00 (Color • A4 • Single Side • PASSPORT_PHOTO)",
    });
  });

  it("applies custom ranges, clamps copies, and keeps paise-exact math", async () => {
    const shop = await createShop();
    shopIds.push(shop.id);
    await createPricing(shop.id, { colorA4Single: "10.55" });
    const doc = await createDocument(10);
    docIds.push(doc.id);
    const custom = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      JSON.stringify({
        shopId: shop.id,
        documentId: doc.id,
        printType: "PRINT",
        colorMode: "COLOR",
        paperSize: "A4",
        printSide: "SINGLE",
        pageRange: "1-3,5,5,99",
        copies: 1,
      })
    );
    expect(custom.json.data).toMatchObject({
      calculatedPages: 4,
      totalPrice: 42.2,
      breakdown:
        "4 Pages × ₹10.55 × 1 Copies = ₹42.20 (Color • A4 • Single Side • PRINT)",
    });

    const clamped = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      JSON.stringify({
        shopId: shop.id,
        documentId: doc.id,
        printType: "PRINT",
        colorMode: "BW",
        paperSize: "A4",
        printSide: "SINGLE",
        copies: 101,
      })
    );
    expect(clamped.json.data.copies).toBe(100);
    expect(clamped.json.data.totalPrice).toBe(2000);
  });

  it("400s missing document/pricing with legacy messages", async () => {
    const shop = await createShop();
    shopIds.push(shop.id);
    await createPricing(shop.id);
    const ghost = "11111111-1111-1111-1111-111111111111";
    const noDoc = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      JSON.stringify({
        shopId: shop.id,
        documentId: ghost,
        printType: "PRINT",
        colorMode: "BW",
        paperSize: "A4",
        printSide: "SINGLE",
      })
    );
    expect(noDoc.status).toBe(400);
    expect(noDoc.json.message).toBe("Document not found");

    const bare = await createShop();
    shopIds.push(bare.id);
    const doc = await createDocument(2);
    docIds.push(doc.id);
    const noPricing = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      JSON.stringify({
        shopId: bare.id,
        documentId: doc.id,
        printType: "PRINT",
        colorMode: "BW",
        paperSize: "A4",
        printSide: "SINGLE",
      })
    );
    expect(noPricing.status).toBe(400);
    expect(noPricing.json.message).toBe("Shop pricing configuration not found");
  });

  it("400s validation failures and malformed input with legacy messages", async () => {
    const shop = await createShop();
    shopIds.push(shop.id);
    await createPricing(shop.id);
    const doc = await createDocument(2);
    docIds.push(doc.id);
    const base = {
      shopId: shop.id,
      documentId: doc.id,
      printType: "PRINT",
      colorMode: "BW",
      paperSize: "A4",
      printSide: "SINGLE",
    };
    const cases: Array<[object, string]> = [
      [{ ...base, shopId: undefined }, "Shop ID is required"],
      [{ ...base, documentId: undefined }, "Document ID is required"],
      [{ ...base, printType: undefined }, "Print type is required"],
      [{ ...base, copies: 0 }, "Copies must be at least 1"],
      [{ ...base, printType: "LASER" }, "Malformed request body"],
      [{ ...base, shopId: "not-a-uuid" }, "Malformed request body"],
    ];
    for (const [body, message] of cases) {
      const r = await postJson(
        calculate,
        "/api/public/pricing/calculate",
        JSON.stringify(body)
      );
      expect(r.status).toBe(400);
      expect(r.json.message).toBe(message);
    }
    const malformed = await postJson(
      calculate,
      "/api/public/pricing/calculate",
      "{not-json"
    );
    expect(malformed.status).toBe(400);
    expect(malformed.json.message).toBe("Malformed request body");
  });
});
