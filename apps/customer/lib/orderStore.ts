import { prisma } from "@printdrop/db";
import {
  ORDER_NUMBER_CONFLICT,
  paiseToDecimal,
  type OrderStore,
  type OrderRow,
} from "@printdrop/domain";

// Prisma-backed order store. Each mutating unit runs in an interactive
// transaction (mirroring @Transactional boundaries); reads are direct.
// Money crosses as exact decimal strings; fileSize BigInt -> Number.

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type { PrismaTx };

export async function readOrderGraphTx(
  db: typeof prisma | PrismaTx,
  where: { id?: string }
): Promise<OrderRow | null> {
  return readOrderGraph(db, where);
}

function conflictError(): Error {
  return Object.assign(new Error("order number collision"), {
    code: ORDER_NUMBER_CONFLICT,
  });
}

function isP2002(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

function p2002TargetsOrderNumber(err: unknown): boolean {
  if (!isP2002(err)) {
    return false;
  }
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.includes("order_number");
  }
  return false;
}

export function integrityError(): Error {
  return Object.assign(
    new Error("Request conflicts with existing data. Please retry."),
    { status: 409 }
  );
}

async function readOrderGraph(
  db: typeof prisma | PrismaTx,
  where: { id?: string; publicToken?: string }
): Promise<OrderRow | null> {
  const order = await (db as typeof prisma).printOrder.findUnique({
    where: where as { id: string },
    include: {
      shop: true,
      items: { include: { document: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (order == null) {
    return null;
  }
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    publicToken: order.publicToken,
    shopId: order.shopId,
    shopName: order.shop.name,
    items: order.items.map((item) => ({
      id: item.id,
      document:
        item.document == null
          ? null
          : {
              id: item.document.id,
              originalFileName: item.document.originalFileName,
              contentType: item.document.contentType,
              fileSize: Number(item.document.fileSize),
              pageCount: item.document.pageCount,
              uploadedAt: item.document.uploadedAt,
              parentDocumentId: item.document.parentDocumentId,
            },
      printType: item.printType,
      colorMode: item.colorMode,
      paperSize: item.paperSize,
      printSide: item.printSide,
      pageRange: item.pageRange,
      copies: item.copies,
      calculatedPages: item.calculatedPages,
      unitPrice: item.unitPrice.toString(),
      itemPrice: item.itemPrice.toString(),
      printStatus: item.printStatus,
      createdAt: item.createdAt,
    })),
    totalPrice: order.totalPrice.toString(),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    printStatus: order.printStatus,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
  };
}

async function readOrderGraphByToken(
  publicToken: string
): Promise<OrderRow | null> {
  const idRow = await prisma.printOrder.findUnique({
    where: { publicToken },
    select: { id: true },
  });
  if (idRow == null) {
    return null;
  }
  return readOrderGraph(prisma, { id: idRow.id });
}

export const prismaOrderStore: OrderStore = {
  async findShopById(shopId: string) {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, isOpen: true },
    });
    return shop;
  },

  async findDocumentById(documentId: string) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, shopId: true, pageCount: true },
    });
    return doc;
  },

  async findPricingByShopId(shopId: string) {
    const pricing = await prisma.shopPricing.findUnique({ where: { shopId } });
    if (pricing == null) {
      return null;
    }
    return {
      bwA4Single: pricing.bwA4Single.toString(),
      bwA4Double: pricing.bwA4Double.toString(),
      colorA4Single: pricing.colorA4Single.toString(),
      colorA4Double: pricing.colorA4Double.toString(),
      bwA3Single: pricing.bwA3Single.toString(),
      bwA3Double: pricing.bwA3Double.toString(),
      colorA3Single: pricing.colorA3Single.toString(),
      colorA3Double: pricing.colorA3Double.toString(),
      passportPrice: pricing.passportPrice.toString(),
    };
  },

  async existsOrderNumber(orderNumber: string) {
    const row = await prisma.printOrder.findUnique({
      where: { orderNumber },
      select: { id: true },
    });
    return row != null;
  },

  async saveNewOrder(input) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const order = await tx.printOrder.create({
          data: {
            orderNumber: input.orderNumber,
            publicToken: crypto.randomUUID(),
            shopId: input.shopId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            paymentMethod: input.paymentMethod,
            paymentStatus: "PENDING",
            printStatus: "PENDING",
            totalPrice: paiseToDecimal(input.totalPaise),
            razorpayOrderId: input.razorpayOrderId,
            documentId: input.legacy.documentId,
            printType: input.legacy.printType,
            colorMode: input.legacy.colorMode,
            paperSize: input.legacy.paperSize,
            printSide: input.legacy.printSide,
            pageRange: input.legacy.pageRange,
            copies: input.legacy.copies,
            calculatedPages: input.legacy.calculatedPages,
            createdAt: now,
            updatedAt: now,
            items: {
              create: input.items.map((item) => ({
                documentId: item.documentId,
                printType: item.printType,
                colorMode: item.colorMode,
                paperSize: item.paperSize,
                printSide: item.printSide,
                pageRange: item.pageRange,
                copies: item.copies,
                calculatedPages: item.calculatedPages,
                unitPrice: item.unitPrice,
                itemPrice: item.itemPrice,
                printStatus: "PENDING",
                createdAt: now,
                updatedAt: now,
              })),
            },
          },
        });
        await tx.payment.create({
          data: {
            orderId: order.id,
            transactionId:
              input.paymentMethod === "PAY_AT_SHOP"
                ? `CASH-${input.orderNumber}`
                : null,
            amount: paiseToDecimal(input.totalPaise),
            paymentMethod: input.paymentMethod,
            status: "PENDING",
            createdAt: now,
          },
        });
        if (input.createJob) {
          await tx.printJob.create({
            data: { orderId: order.id, status: "QUEUED", createdAt: now, updatedAt: now },
          });
        }
        const full = await readOrderGraph(tx as unknown as typeof prisma, {
          id: order.id,
        });
        if (full == null) {
          throw new Error("order vanished after create");
        }
        return full;
      });
    } catch (err) {
      if (p2002TargetsOrderNumber(err)) {
        throw conflictError();
      }
      if (isP2002(err)) {
        throw integrityError();
      }
      throw err;
    }
  },

  async findOrderById(orderId: string) {
    return readOrderGraph(prisma, { id: orderId });
  },

  async findOrderByPublicToken(publicToken: string) {
    return readOrderGraphByToken(publicToken);
  },

  async findOrdersByShop(shopId: string, printStatus: string | null) {
    const orders = await prisma.printOrder.findMany({
      where: { shopId, ...(printStatus != null ? { printStatus } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const rows: OrderRow[] = [];
    for (const o of orders) {
      const full = await readOrderGraph(prisma, { id: o.id });
      if (full != null) {
        rows.push(full);
      }
    }
    return rows;
  },

  async applyPrintStatus(orderId, printStatus, jobAction) {
    return prisma.$transaction(async (tx) => {
      await tx.printOrder.update({
        where: { id: orderId },
        data: { printStatus },
      });
      await tx.orderItem.updateMany({
        where: { orderId },
        data: { printStatus },
      });
      if (jobAction === "reset-or-create") {
        const job = await tx.printJob.findUnique({ where: { orderId } });
        if (job == null) {
          await tx.printJob.create({ data: { orderId, status: "QUEUED", createdAt: new Date(), updatedAt: new Date() } });
        } else if (job.status === "FAILED" || job.status === "COMPLETED") {
          await tx.printJob.update({
            where: { id: job.id },
            data: { status: "QUEUED", assignedAgentId: null },
          });
        }
      } else if (jobAction === "complete") {
        const job = await tx.printJob.findUnique({ where: { orderId } });
        if (job != null) {
          await tx.printJob.update({
            where: { id: job.id },
            data: { status: "COMPLETED" },
          });
        }
      } else if (jobAction === "fail") {
        const job = await tx.printJob.findUnique({ where: { orderId } });
        if (job != null) {
          await tx.printJob.update({
            where: { id: job.id },
            data: { status: "FAILED" },
          });
        }
      } else if (jobAction === "ensure-queued") {
        const job = await tx.printJob.findUnique({ where: { orderId } });
        if (job == null) {
          await tx.printJob.create({ data: { orderId, status: "QUEUED", createdAt: new Date(), updatedAt: new Date() } });
        } else if (job.status !== "QUEUED") {
          await tx.printJob.update({
            where: { id: job.id },
            data: { status: "QUEUED", assignedAgentId: null },
          });
        }
      }
      const full = await readOrderGraph(tx as unknown as typeof prisma, {
        id: orderId,
      });
      if (full == null) {
        throw new Error("order vanished during status update");
      }
      return full;
    });
  },

  async applyItemPrintStatus(orderId, itemId, printStatus, derivedStatus) {
    return prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: { printStatus },
      });
      await tx.printOrder.update({
        where: { id: orderId },
        data: { printStatus: derivedStatus },
      });
      const full = await readOrderGraph(tx as unknown as typeof prisma, {
        id: orderId,
      });
      if (full == null) {
        throw new Error("order vanished during item update");
      }
      return full;
    });
  },

  async applyDocumentSwap(
    orderId,
    itemId,
    documentId,
    calculatedPages,
    unitPrice,
    itemPrice,
    totalPaise,
    mirrorLegacy
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          documentId,
          calculatedPages,
          unitPrice,
          itemPrice,
        },
      });
      await tx.printOrder.update({
        where: { id: orderId },
        data: {
          totalPrice: paiseToDecimal(totalPaise),
          ...(mirrorLegacy
            ? { documentId, calculatedPages }
            : {}),
        },
      });
      const full = await readOrderGraph(tx as unknown as typeof prisma, {
        id: orderId,
      });
      if (full == null) {
        throw new Error("order vanished during document swap");
      }
      return full;
    });
  },

  async findDocumentLineage(documentId: string) {
    const byId = new Map<
      string,
      {
        id: string;
        originalFileName: string;
        contentType: string | null;
        fileSize: number;
        pageCount: number;
        uploadedAt: Date;
        parentDocumentId: string | null;
      }
    >();
    const load = async (id: string) => {
      if (!byId.has(id)) {
        const row = await prisma.document.findUnique({ where: { id } });
        if (row != null) {
          byId.set(id, {
            id: row.id,
            originalFileName: row.originalFileName,
            contentType: row.contentType,
            fileSize: Number(row.fileSize),
            pageCount: row.pageCount,
            uploadedAt: row.uploadedAt,
            parentDocumentId: row.parentDocumentId,
          });
        }
      }
      return byId.get(id) ?? null;
    };
    let root = await load(documentId);
    if (root == null) {
      return { rootId: documentId, siblings: [], byId };
    }
    for (let depth = 0; depth < 10; depth++) {
      if (root.parentDocumentId == null) {
        break;
      }
      const parent = await load(root.parentDocumentId);
      if (parent == null) {
        break;
      }
      root = parent;
    }
    const siblingRows = await prisma.document.findMany({
      where: { parentDocumentId: root.id },
    });
    const siblings = siblingRows.map((row) => ({
      id: row.id,
      originalFileName: row.originalFileName,
      contentType: row.contentType,
      fileSize: Number(row.fileSize),
      pageCount: row.pageCount,
      uploadedAt: row.uploadedAt,
      parentDocumentId: row.parentDocumentId,
    }));
    for (const s of siblings) {
      byId.set(s.id, s);
    }
    return { rootId: root.id, siblings, byId };
  },

  async existsDocumentInShop(shopId: string, documentId: string) {
    const [itemRef, legacyRef] = await Promise.all([
      prisma.orderItem.findFirst({
        where: { documentId, order: { shopId } },
        select: { id: true },
      }),
      prisma.printOrder.findFirst({
        where: { documentId, shopId },
        select: { id: true },
      }),
    ]);
    return itemRef != null || legacyRef != null;
  },

  async findPaymentByOrderId(orderId: string) {
    const payment = await prisma.payment.findUnique({ where: { orderId } });
    if (payment == null) {
      return null;
    }
    return { transactionId: payment.transactionId };
  },

  async applyPaymentStatus(orderId, paymentStatus, transactionId, createJob) {
    return prisma.$transaction(async (tx) => {
      await tx.printOrder.update({
        where: { id: orderId },
        data: { paymentStatus },
      });
      const existing = await tx.payment.findUnique({ where: { orderId } });
      if (existing == null) {
        const order = await tx.printOrder.findUnique({
          where: { id: orderId },
        });
        await tx.payment.create({
          data: {
            orderId,
            amount: order!.totalPrice,
            paymentMethod: order!.paymentMethod,
            status: paymentStatus,
            transactionId,
            createdAt: new Date(),
          },
        });
      } else {
        await tx.payment.update({
          where: { id: existing.id },
          data: {
            status: paymentStatus,
            ...(transactionId != null ? { transactionId } : {}),
          },
        });
      }
      if (createJob) {
        const job = await tx.printJob.findUnique({ where: { orderId } });
        if (job == null) {
          await tx.printJob.create({ data: { orderId, status: "QUEUED", createdAt: new Date(), updatedAt: new Date() } });
        }
      }
      const full = await readOrderGraph(tx as unknown as typeof prisma, {
        id: orderId,
      });
      if (full == null) {
        throw new Error("order vanished during payment update");
      }
      return full;
    });
  },

  async findPaymentStatus(orderId: string) {
    const payment = await prisma.payment.findUnique({
      where: { orderId },
      select: { status: true },
    });
    return payment?.status ?? null;
  },

  async deleteOrderGraph(orderId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.printJob.deleteMany({ where: { orderId } });
      await tx.payment.deleteMany({ where: { orderId } });
      await tx.printOrder.delete({ where: { id: orderId } });
    });
  },
};

