import { assertServerRuntime } from "./serverOnly.js";

// Admin file management. Source:
// backend/.../service/AdminDocumentService.java — full transcription:
// order-derived listing with latest-order metadata, PENDING/PRINTING
// processing flags, search/type/sort rules, manual pagination,
// object-first deletes with nullify + counts, audit log lines.

export interface AdminDocRow {
  id: string;
  originalFileName: string;
  contentType: string | null;
  fileSize: number;
  pageCount: number;
  uploadedAt: Date;
}

export interface AdminOrderRef {
  id: string;
  orderNumber: string;
  customerName: string | null;
  printStatus: string;
  items: Array<{ documentId: string | null; printStatus: string }>;
  legacyDocumentId: string | null;
}

export interface AdminDocumentDTOBody {
  id: string;
  originalFileName: string;
  contentType: string | null;
  fileSize: number;
  pageCount: number;
  uploadedAt: string;
  orderId: string | null;
  orderNumber: string;
  customerName: string;
  orderPrintStatus: string;
  canDelete: boolean;
  isProcessing: boolean;
  parentDocumentId?: string | null;
}

export class AdminDocumentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 500 = 400
  ) {
    super(message);
  }
}

export interface AdminDocumentStore {
  findOrdersByShop(shopId: string): Promise<AdminOrderRef[]>;
  findDocumentById(documentId: string): Promise<
    (AdminDocRow & { storedFileName: string; shopId: string | null }) | null
  >;
  existsDocumentInShop(shopId: string, documentId: string): Promise<boolean>;
  findOrdersReferencing(shopId: string, documentId: string): Promise<AdminOrderRef[]>;
  nullifyDocumentReferences(documentId: string): Promise<void>;
  deleteDocumentRow(documentId: string): Promise<void>;
}

function buildDto(
  doc: AdminDocRow,
  order: AdminOrderRef | null,
  status: string | null
): AdminDocumentDTOBody {
  const processing =
    order != null &&
    (order.printStatus === "PENDING" || order.printStatus === "PRINTING");
  return {
    id: doc.id,
    originalFileName: doc.originalFileName,
    contentType: doc.contentType,
    fileSize: doc.fileSize,
    pageCount: doc.pageCount,
    uploadedAt: doc.uploadedAt.toISOString(),
    orderId: order != null ? order.id : null,
    orderNumber: order != null ? order.orderNumber : "N/A",
    customerName: order != null && order.customerName ? order.customerName : "Walk-in",
    orderPrintStatus:
      status ?? (order != null ? order.printStatus : "PENDING"),
    canDelete: !processing,
    isProcessing: processing,
  };
}

export interface DocumentPage {
  content: AdminDocumentDTOBody[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  numberOfElements: number;
  first: boolean;
  last: boolean;
  empty: boolean;
}

export async function getShopDocuments(
  store: AdminDocumentStore,
  shopId: string,
  search: string | null,
  type: string | null,
  sort: string | null,
  page: number,
  size: number
): Promise<DocumentPage> {
  assertServerRuntime("getShopDocuments");
  if (shopId == null) {
    throw new AdminDocumentError("Unauthorized: Shop context missing", 403);
  }
  const orders = await store.findOrdersByShop(shopId);
  const docs = new Map<string, AdminDocRow>();
  const fetchDoc = async (id: string): Promise<AdminDocRow | null> => {
    if (!docs.has(id)) {
      const row = await store.findDocumentById(id);
      if (row != null) {
        docs.set(id, row);
      }
    }
    return docs.get(id) ?? null;
  };

  const documentMap = new Map<string, AdminDocumentDTOBody>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.documentId != null) {
        const doc = await fetchDoc(item.documentId);
        if (doc != null && !documentMap.has(doc.id)) {
          documentMap.set(doc.id, buildDto(doc, order, item.printStatus));
        }
      }
    }
    if (order.legacyDocumentId != null) {
      const doc = await fetchDoc(order.legacyDocumentId);
      if (doc != null && !documentMap.has(doc.id)) {
        documentMap.set(doc.id, buildDto(doc, order, order.printStatus));
      }
    }
  }

  for (const order of orders) {
    const active =
      order.printStatus === "PENDING" || order.printStatus === "PRINTING";
    if (!active) {
      continue;
    }
    const mark = (docId: string | null) => {
      if (docId != null) {
        const dto = documentMap.get(docId);
        if (dto != null) {
          dto.isProcessing = true;
          dto.canDelete = false;
        }
      }
    };
    for (const item of order.items) {
      mark(item.documentId);
    }
    mark(order.legacyDocumentId);
  }

  let list = [...documentMap.values()];
  if (search != null && search.trim().length > 0) {
    const query = search.trim().toLowerCase();
    list = list.filter(
      (d) =>
        (d.originalFileName != null &&
          d.originalFileName.toLowerCase().includes(query)) ||
        (d.orderNumber != null &&
          d.orderNumber.toLowerCase().includes(query)) ||
        (d.customerName != null &&
          d.customerName.toLowerCase().includes(query))
    );
  }
  if (type != null && type.trim().length > 0 && type.toUpperCase() !== "ALL") {
    const filterType = type.trim().toUpperCase();
    list = list.filter((d) => {
      const ct = d.contentType != null ? d.contentType.toLowerCase() : "";
      const fn =
        d.originalFileName != null ? d.originalFileName.toLowerCase() : "";
      if (filterType === "PDF") {
        return ct.includes("pdf") || fn.endsWith(".pdf");
      }
      if (filterType === "IMAGE" || filterType === "IMAGES") {
        return (
          ct.startsWith("image/") ||
          fn.endsWith(".jpg") ||
          fn.endsWith(".jpeg") ||
          fn.endsWith(".png")
        );
      }
      if (
        filterType === "DOC" ||
        filterType === "DOCS" ||
        filterType === "WORD"
      ) {
        return (
          ct.includes("word") ||
          ct.includes("officedocument") ||
          fn.endsWith(".doc") ||
          fn.endsWith(".docx")
        );
      }
      return true;
    });
  }
  const byUploaded = (d: AdminDocumentDTOBody) => d.uploadedAt;
  if (sort != null && sort.toUpperCase() === "OLDEST") {
    list.sort((a, b) => byUploaded(a).localeCompare(byUploaded(b)));
  } else if (sort != null && sort.toUpperCase() === "SIZE_DESC") {
    list.sort((a, b) => b.fileSize - a.fileSize);
  } else if (sort != null && sort.toUpperCase() === "SIZE_ASC") {
    list.sort((a, b) => a.fileSize - b.fileSize);
  } else {
    list.sort((a, b) => byUploaded(b).localeCompare(byUploaded(a)));
  }

  const totalElements = list.length;
  const pageNumber = Math.max(0, page);
  const pageSize = Math.max(1, size);
  const fromIndex = Math.min(pageNumber * pageSize, totalElements);
  const toIndex = Math.min(fromIndex + pageSize, totalElements);
  const content = list.slice(fromIndex, toIndex);
  const totalPages = Math.ceil(totalElements / pageSize);
  return {
    content,
    totalElements,
    totalPages,
    number: pageNumber,
    size: pageSize,
    numberOfElements: content.length,
    first: pageNumber === 0,
    last: pageNumber >= totalPages - 1 || totalElements === 0,
    empty: content.length === 0,
  };
}

export interface ObjectDeleter {
  remove(key: string): Promise<boolean>;
}

export async function deleteDocument(
  store: AdminDocumentStore,
  objects: ObjectDeleter,
  shopId: string | null,
  documentId: string | null
): Promise<void> {
  assertServerRuntime("deleteDocument");
  if (shopId == null || documentId == null) {
    throw new AdminDocumentError("Shop context or document ID missing", 400);
  }
  if (!(await store.existsDocumentInShop(shopId, documentId))) {
    throw new AdminDocumentError(
      "Document does not belong to your shop or does not exist",
      403
    );
  }
  const orders = await store.findOrdersReferencing(shopId, documentId);
  const processing = orders.some(
    (o) => o.printStatus === "PENDING" || o.printStatus === "PRINTING"
  );
  if (processing) {
    throw new AdminDocumentError(
      "Document cannot be deleted while it is being processed by an active print job or pending order.",
      400
    );
  }
  const document = await store.findDocumentById(documentId);
  if (document == null) {
    return;
  }
  const removed = await objects.remove(document.storedFileName);
  if (!removed) {
    const err = new AdminDocumentError(
      "Failed to delete document file from storage; database record preserved",
      500
    );
    throw err;
  }
  await store.nullifyDocumentReferences(documentId);
  await store.deleteDocumentRow(documentId);
}

export async function deleteBulkDocuments(
  store: AdminDocumentStore,
  objects: ObjectDeleter,
  shopId: string | null,
  documentIds: string[] | null
): Promise<number> {
  assertServerRuntime("deleteBulkDocuments");
  if (shopId == null || documentIds == null || documentIds.length === 0) {
    return 0;
  }
  let deletedCount = 0;
  for (const docId of documentIds) {
    if (docId == null) {
      continue;
    }
    try {
      if (!(await store.existsDocumentInShop(shopId, docId))) {
        continue;
      }
      const orders = await store.findOrdersReferencing(shopId, docId);
      const processing = orders.some(
        (o) => o.printStatus === "PENDING" || o.printStatus === "PRINTING"
      );
      if (processing) {
        continue;
      }
      const document = await store.findDocumentById(docId);
      if (document != null) {
        if (!(await objects.remove(document.storedFileName))) {
          continue;
        }
        await store.nullifyDocumentReferences(docId);
        await store.deleteDocumentRow(docId);
        deletedCount++;
      }
    } catch {
      continue;
    }
  }
  return deletedCount;
}

export async function deleteAllShopDocuments(
  store: AdminDocumentStore,
  objects: ObjectDeleter,
  shopId: string | null
): Promise<{
  deletedCount: number;
  skippedActiveCount: number;
  totalCandidateDocuments: number;
}> {
  assertServerRuntime("deleteAllShopDocuments");
  if (shopId == null) {
    throw new AdminDocumentError("Unauthorized: Shop context missing", 403);
  }
  const orders = await store.findOrdersByShop(shopId);
  const allIds: string[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      if (item.documentId != null && !allIds.includes(item.documentId)) {
        allIds.push(item.documentId);
      }
    }
    if (order.legacyDocumentId != null && !allIds.includes(order.legacyDocumentId)) {
      allIds.push(order.legacyDocumentId);
    }
  }
  let deletedCount = 0;
  let skippedActiveCount = 0;
  for (const docId of allIds) {
    try {
      const docOrders = await store.findOrdersReferencing(shopId, docId);
      const processing = docOrders.some(
        (o) => o.printStatus === "PENDING" || o.printStatus === "PRINTING"
      );
      if (processing) {
        skippedActiveCount++;
        continue;
      }
      const document = await store.findDocumentById(docId);
      if (document != null) {
        if (!(await objects.remove(document.storedFileName))) {
          continue;
        }
        await store.nullifyDocumentReferences(docId);
        await store.deleteDocumentRow(docId);
        deletedCount++;
      }
    } catch {
      continue;
    }
  }
  return {
    deletedCount,
    skippedActiveCount,
    totalCandidateDocuments: allIds.length,
  };
}
