import { prisma } from "@printdrop/db";
import type { DocumentDb, DocumentRow } from "@printdrop/domain";

// Prisma-backed document store: row CRUD + ownership reads mirroring
// AdminDocumentService.hasDocumentAccess (order-ref OR orphan shopId) and
// the download endpoints (order-ref only — orphans 403 there).
export const prismaDocumentDb: DocumentDb = {
  async insertDocument(input: {
    originalFileName: string;
    storedFileName: string;
    contentType: string | null;
    fileSize: number;
    pageCount: number;
    uploadedAt: Date;
    shopId: string | null;
  }): Promise<DocumentRow> {
    const row = await prisma.document.create({ data: { ...input } });
    return toRow(row);
  },

  async setParentDocumentId(
    id: string,
    parentDocumentId: string
  ): Promise<DocumentRow> {
    const row = await prisma.document.update({
      where: { id },
      data: { parentDocumentId },
    });
    return toRow(row);
  },

  async findDocumentById(id: string): Promise<DocumentRow | null> {
    const row = await prisma.document.findUnique({ where: { id } });
    return row == null ? null : toRow(row);
  },

  async nullifyDocumentReferences(documentId: string): Promise<void> {
    await prisma.orderItem.updateMany({
      where: { documentId },
      data: { documentId: null },
    });
    await prisma.printOrder.updateMany({
      where: { documentId },
      data: { documentId: null },
    });
  },

  async deleteDocumentRow(documentId: string): Promise<void> {
    await prisma.document.delete({ where: { id: documentId } });
  },
};

function toRow(row: {
  id: string;
  originalFileName: string;
  storedFileName: string;
  contentType: string | null;
  fileSize: bigint;
  pageCount: number;
  uploadedAt: Date;
  shopId: string | null;
  parentDocumentId: string | null;
}): DocumentRow {
  return {
    id: row.id,
    originalFileName: row.originalFileName,
    storedFileName: row.storedFileName,
    contentType: row.contentType,
    fileSize: Number(row.fileSize),
    pageCount: row.pageCount,
    uploadedAt: row.uploadedAt,
    shopId: row.shopId,
    parentDocumentId: row.parentDocumentId,
  };
}

/** Order-ref ownership (download endpoints + delete primary proof). */
export async function orderRefAccess(
  shopId: string,
  documentId: string
): Promise<boolean> {
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
}

/** Full hasDocumentAccess: order-ref OR orphan upload-shopId match. */
export async function documentAccess(
  shopId: string,
  documentId: string
): Promise<boolean> {
  if (await orderRefAccess(shopId, documentId)) {
    return true;
  }
  const orphan = await prisma.document.findUnique({
    where: { id: documentId },
  });
  return orphan != null && orphan.shopId === shopId;
}

export async function findShopIdBySlug(
  slug: string
): Promise<string | null> {
  const shop = await prisma.shop.findUnique({
    where: { slug },
    select: { id: true },
  });
  return shop?.id ?? null;
}
