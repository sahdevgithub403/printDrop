import { prisma } from "@printdrop/db";
import type { AdminDocumentStore } from "@printdrop/domain";

// Prisma-backed admin document store: order-derived listing reads,
// order-ref/orphan ownership, and nullify+delete primitives.

export const prismaAdminDocumentStore: AdminDocumentStore = {
  async findOrdersByShop(shopId: string) {
    const orders = await prisma.printOrder.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      include: {
        items: { select: { documentId: true, printStatus: true } },
      },
    });
    return orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      printStatus: o.printStatus,
      items: o.items.map((i) => ({
        documentId: i.documentId,
        printStatus: i.printStatus,
      })),
      legacyDocumentId: o.documentId,
    }));
  },

  async findDocumentById(documentId: string) {
    const row = await prisma.document.findUnique({ where: { id: documentId } });
    if (row == null) {
      return null;
    }
    return {
      id: row.id,
      originalFileName: row.originalFileName,
      contentType: row.contentType,
      fileSize: Number(row.fileSize),
      pageCount: row.pageCount,
      uploadedAt: row.uploadedAt,
      storedFileName: row.storedFileName,
      shopId: row.shopId,
    };
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
    if (itemRef != null || legacyRef != null) {
      return true;
    }
    const orphan = await prisma.document.findUnique({
      where: { id: documentId },
    });
    return orphan != null && orphan.shopId === shopId;
  },

  async findOrdersReferencing(shopId: string, documentId: string) {
    const orders = await prisma.printOrder.findMany({
      where: {
        shopId,
        OR: [
          { items: { some: { documentId } } },
          { documentId },
        ],
      },
      include: {
        items: { select: { documentId: true, printStatus: true } },
      },
    });
    return orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      printStatus: o.printStatus,
      items: o.items.map((i) => ({
        documentId: i.documentId,
        printStatus: i.printStatus,
      })),
      legacyDocumentId: o.documentId,
    }));
  },

  async nullifyDocumentReferences(documentId: string) {
    await prisma.orderItem.updateMany({
      where: { documentId },
      data: { documentId: null },
    });
    await prisma.printOrder.updateMany({
      where: { documentId },
      data: { documentId: null },
    });
  },

  async deleteDocumentRow(documentId: string) {
    await prisma.document.delete({ where: { id: documentId } });
  },
};
