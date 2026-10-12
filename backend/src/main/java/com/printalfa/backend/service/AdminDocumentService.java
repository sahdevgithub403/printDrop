package com.printalfa.backend.service;

import com.printalfa.backend.dto.AdminDocumentDTO;
import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.OrderItem;
import com.printalfa.backend.entity.PrintOrder;
import com.printalfa.backend.enums.PrintStatus;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.OrderItemRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class AdminDocumentService {

    private final DocumentRepository documentRepository;
    private final PrintOrderRepository printOrderRepository;
    private final OrderItemRepository orderItemRepository;
    private final FileStorageService fileStorageService;

    public AdminDocumentService(DocumentRepository documentRepository,
                                PrintOrderRepository printOrderRepository,
                                OrderItemRepository orderItemRepository,
                                FileStorageService fileStorageService) {
        this.documentRepository = documentRepository;
        this.printOrderRepository = printOrderRepository;
        this.orderItemRepository = orderItemRepository;
        this.fileStorageService = fileStorageService;
    }

    @Transactional(readOnly = true)
    public Page<AdminDocumentDTO> getShopDocuments(UUID shopId, String search, String type, String sort, int page, int size) {
        if (shopId == null) {
            throw new AccessDeniedException("Unauthorized: Shop context missing");
        }

        // Fetch all orders for this shop
        List<PrintOrder> orders = printOrderRepository.findByShopIdOrderByCreatedAtDesc(shopId);

        // Map documents with their latest associated order metadata in this shop
        Map<UUID, AdminDocumentDTO> documentMap = new LinkedHashMap<>();

        for (PrintOrder order : orders) {
            // Check items
            if (order.getItems() != null) {
                for (OrderItem item : order.getItems()) {
                    if (item.getDocument() != null) {
                        Document doc = item.getDocument();
                        documentMap.computeIfAbsent(doc.getId(), id -> buildDto(doc, order, item.getPrintStatus()));
                    }
                }
            }
            // Check legacy order document
            if (order.getDocument() != null) {
                Document doc = order.getDocument();
                documentMap.computeIfAbsent(doc.getId(), id -> buildDto(doc, order, order.getPrintStatus()));
            }
        }

        // Update isProcessing and canDelete across all orders referencing the document
        for (PrintOrder order : orders) {
            boolean isOrderActive = order.getPrintStatus() == PrintStatus.PENDING || order.getPrintStatus() == PrintStatus.PRINTING;
            if (isOrderActive) {
                if (order.getItems() != null) {
                    for (OrderItem item : order.getItems()) {
                        if (item.getDocument() != null && documentMap.containsKey(item.getDocument().getId())) {
                            AdminDocumentDTO dto = documentMap.get(item.getDocument().getId());
                            dto.setProcessing(true);
                            dto.setCanDelete(false);
                        }
                    }
                }
                if (order.getDocument() != null && documentMap.containsKey(order.getDocument().getId())) {
                    AdminDocumentDTO dto = documentMap.get(order.getDocument().getId());
                    dto.setProcessing(true);
                    dto.setCanDelete(false);
                }
            }
        }

        List<AdminDocumentDTO> list = new ArrayList<>(documentMap.values());

        // Apply search filter (filename, order number, or customer name)
        if (search != null && !search.trim().isEmpty()) {
            String query = search.trim().toLowerCase();
            list = list.stream()
                    .filter(d -> (d.getOriginalFileName() != null && d.getOriginalFileName().toLowerCase().contains(query))
                            || (d.getOrderNumber() != null && d.getOrderNumber().toLowerCase().contains(query))
                            || (d.getCustomerName() != null && d.getCustomerName().toLowerCase().contains(query)))
                    .collect(Collectors.toList());
        }

        // Apply type filter
        if (type != null && !type.trim().isEmpty() && !"ALL".equalsIgnoreCase(type)) {
            String filterType = type.trim().toUpperCase();
            list = list.stream()
                    .filter(d -> {
                        String ct = d.getContentType() != null ? d.getContentType().toLowerCase() : "";
                        String fn = d.getOriginalFileName() != null ? d.getOriginalFileName().toLowerCase() : "";
                        if ("PDF".equals(filterType)) {
                            return ct.contains("pdf") || fn.endsWith(".pdf");
                        } else if ("IMAGE".equals(filterType) || "IMAGES".equals(filterType)) {
                            return ct.startsWith("image/") || fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".png");
                        } else if ("DOC".equals(filterType) || "DOCS".equals(filterType) || "WORD".equals(filterType)) {
                            return ct.contains("word") || ct.contains("officedocument") || fn.endsWith(".doc") || fn.endsWith(".docx");
                        }
                        return true;
                    })
                    .collect(Collectors.toList());
        }

        // Apply sorting
        if ("OLDEST".equalsIgnoreCase(sort)) {
            list.sort(Comparator.comparing(AdminDocumentDTO::getUploadedAt, Comparator.nullsLast(Comparator.naturalOrder())));
        } else if ("SIZE_DESC".equalsIgnoreCase(sort)) {
            list.sort(Comparator.comparingLong(AdminDocumentDTO::getFileSize).reversed());
        } else if ("SIZE_ASC".equalsIgnoreCase(sort)) {
            list.sort(Comparator.comparingLong(AdminDocumentDTO::getFileSize));
        } else {
            // Default NEWEST
            list.sort(Comparator.comparing(AdminDocumentDTO::getUploadedAt, Comparator.nullsLast(Comparator.reverseOrder())));
        }

        // Pagination slicing
        int totalElements = list.size();
        int pageNumber = Math.max(0, page);
        int pageSize = Math.max(1, size);
        int fromIndex = Math.min(pageNumber * pageSize, totalElements);
        int toIndex = Math.min(fromIndex + pageSize, totalElements);

        List<AdminDocumentDTO> pageContent = list.subList(fromIndex, toIndex);
        Pageable pageable = PageRequest.of(pageNumber, pageSize);

        return new PageImpl<>(pageContent, pageable, totalElements);
    }

    private AdminDocumentDTO buildDto(Document doc, PrintOrder order, PrintStatus status) {
        boolean isProcessing = order != null && (order.getPrintStatus() == PrintStatus.PENDING || order.getPrintStatus() == PrintStatus.PRINTING);
        return AdminDocumentDTO.builder()
                .id(doc.getId())
                .originalFileName(doc.getOriginalFileName())
                .contentType(doc.getContentType())
                .fileSize(doc.getFileSize())
                .pageCount(doc.getPageCount())
                .uploadedAt(doc.getUploadedAt())
                .orderId(order != null ? order.getId() : null)
                .orderNumber(order != null ? order.getOrderNumber() : "N/A")
                .customerName(order != null ? order.getCustomerName() : "Walk-in")
                .orderPrintStatus(status != null ? status : (order != null ? order.getPrintStatus() : PrintStatus.PENDING))
                .canDelete(!isProcessing)
                .isProcessing(isProcessing)
                .build();
    }

    /**
     * Shop ownership for a document. Primary proof is a referencing order in
     * this shop. Fallback covers orphaned documents whose referencing orders
     * were all deleted: the shopId bound at upload time is the ownership
     * proof. Documents with no order reference AND no (or mismatched) upload
     * shopId are denied — guessing a UUID alone never grants access.
     */
    private boolean hasDocumentAccess(UUID shopId, UUID documentId) {
        if (shopId == null || documentId == null) {
            return false;
        }
        if (printOrderRepository.existsByShopIdAndDocumentId(shopId, documentId)) {
            return true;
        }
        Document orphan = documentRepository.findById(documentId).orElse(null);
        return orphan != null && shopId.equals(orphan.getShopId());
    }

    @Transactional
    public void deleteDocument(UUID shopId, UUID documentId, UUID userId) {
        if (shopId == null || documentId == null) {
            throw new IllegalArgumentException("Shop context or document ID missing");
        }

        // 1. Verify ownership: document must belong to orders in this shop,
        // or be an orphan still bound to this shop from upload time.
        if (!hasDocumentAccess(shopId, documentId)) {
            throw new AccessDeniedException("Document does not belong to your shop or does not exist");
        }

        // 2. Locate all orders in this shop referencing this document
        List<PrintOrder> orders = printOrderRepository.findOrdersByShopIdAndDocumentId(shopId, documentId);

        // 3. Check if any order is currently active/processing
        boolean isProcessing = orders.stream().anyMatch(o -> o.getPrintStatus() == PrintStatus.PENDING || o.getPrintStatus() == PrintStatus.PRINTING);
        if (isProcessing) {
            throw new IllegalStateException("Document cannot be deleted while it is being processed by an active print job or pending order.");
        }

        Document document = documentRepository.findById(documentId)
                .orElse(null);

        if (document == null) {
            return;
        }

        String originalFileName = document.getOriginalFileName();
        String storedFileName = document.getStoredFileName();

        // 4. Delete the physical file FIRST so the DB row is only removed when
        // the filesystem delete succeeded (M-06 consistency).
        boolean physicalDeleted = fileStorageService.deletePhysicalFile(storedFileName);

        // M-06: physical/DB delete consistency — only remove the DB row when the
        // filesystem delete succeeded; otherwise fail loudly (500) instead of
        // silently orphaning the file or losing the record.
        if (!physicalDeleted) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to delete document file from storage; database record preserved");
        }

        // 5. Nullify foreign key references in SQL to prevent constraint violations
        orderItemRepository.nullifyDocumentReference(documentId);
        printOrderRepository.nullifyDocumentReference(documentId);

        // Also update any in-memory instances
        for (PrintOrder order : orders) {
            if (order.getDocument() != null && order.getDocument().getId().equals(documentId)) {
                order.setDocument(null);
            }
            if (order.getItems() != null) {
                for (OrderItem item : order.getItems()) {
                    if (item.getDocument() != null && item.getDocument().getId().equals(documentId)) {
                        item.setDocument(null);
                    }
                }
            }
        }

        // 6. Delete database record
        documentRepository.deleteDocumentByIdDirect(documentId);

        // 7. Audit log
        log.info("[AUDIT] Admin user '{}' (shop '{}') deleted document '{}' (id: '{}', storedFile: '{}', physicalDeleted: {}) at {}",
                userId, shopId, originalFileName, documentId, storedFileName, physicalDeleted, LocalDateTime.now());
    }

    @Transactional
    public AdminDocumentDTO uploadEditedCopy(UUID shopId, org.springframework.web.multipart.MultipartFile file,
                                             UUID sourceDocumentId, UUID userId) {
        if (shopId == null) {
            throw new AccessDeniedException("Unauthorized: Shop context missing");
        }
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Edited file is missing");
        }
        // The edited copy must derive from a document this shop may access.
        if (sourceDocumentId != null && !hasDocumentAccess(shopId, sourceDocumentId)) {
            throw new AccessDeniedException("Source document does not belong to your shop or does not exist");
        }
        Document saved = fileStorageService.uploadFile(file, shopId);
        if (sourceDocumentId != null) {
            saved.setParentDocumentId(sourceDocumentId);
            saved = documentRepository.save(saved);
        }
        log.info("[AUDIT] Admin user '{}' (shop '{}') uploaded edited copy '{}' (id: '{}', source: '{}') at {}",
                userId, shopId, saved.getOriginalFileName(), saved.getId(), sourceDocumentId, LocalDateTime.now());
        AdminDocumentDTO dto = AdminDocumentDTO.builder()
                .id(saved.getId())
                .originalFileName(saved.getOriginalFileName())
                .contentType(saved.getContentType())
                .fileSize(saved.getFileSize())
                .pageCount(saved.getPageCount())
                .uploadedAt(saved.getUploadedAt())
                .orderId(null)
                .orderNumber("N/A")
                .customerName("Walk-in")
                .orderPrintStatus(PrintStatus.PENDING)
                .canDelete(true)
                .isProcessing(false)
                .build();
        dto.setParentDocumentId(saved.getParentDocumentId());
        return dto;
    }

    @Transactional
    public int deleteBulkDocuments(UUID shopId, List<UUID> documentIds, UUID userId) {
        if (shopId == null || documentIds == null || documentIds.isEmpty()) {
            return 0;
        }

        int deletedCount = 0;
        for (UUID docId : documentIds) {
            if (docId == null) continue;
            try {
                if (!hasDocumentAccess(shopId, docId)) {
                    log.warn("[AUDIT] Bulk delete skipped document {}: does not belong to shop {}", docId, shopId);
                    continue;
                }

                List<PrintOrder> orders = printOrderRepository.findOrdersByShopIdAndDocumentId(shopId, docId);
                boolean isProcessing = orders.stream().anyMatch(o -> o.getPrintStatus() == PrintStatus.PENDING || o.getPrintStatus() == PrintStatus.PRINTING);
                if (isProcessing) {
                    log.warn("[AUDIT] Bulk delete skipped active document {}", docId);
                    continue;
                }

                Document document = documentRepository.findById(docId).orElse(null);
                if (document != null) {
                    String storedFileName = document.getStoredFileName();
                    // M-06: filesystem delete first — only touch DB refs when it succeeds.
                    if (!fileStorageService.deletePhysicalFile(storedFileName)) {
                        log.error("[AUDIT] Bulk delete aborted for document {}: filesystem delete failed, DB row preserved", docId);
                        continue;
                    }
                    orderItemRepository.nullifyDocumentReference(docId);
                    printOrderRepository.nullifyDocumentReference(docId);
                    documentRepository.deleteDocumentByIdDirect(docId);
                    deletedCount++;
                }
            } catch (Exception e) {
                log.error("[AUDIT] Bulk delete error on document {}: {}", docId, e.getMessage());
            }
        }

        log.info("[AUDIT] Bulk deletion completed by admin '{}' (shop '{}'): {}/{} documents deleted at {}",
                userId, shopId, deletedCount, documentIds.size(), LocalDateTime.now());
        return deletedCount;
    }

    @Transactional
    public Map<String, Object> deleteAllShopDocuments(UUID shopId, UUID userId) {
        if (shopId == null) {
            throw new AccessDeniedException("Unauthorized: Shop context missing");
        }

        List<PrintOrder> orders = printOrderRepository.findByShopIdOrderByCreatedAtDesc(shopId);
        Set<UUID> allShopDocIds = new LinkedHashSet<>();

        for (PrintOrder order : orders) {
            if (order.getItems() != null) {
                for (OrderItem item : order.getItems()) {
                    if (item.getDocument() != null) {
                        allShopDocIds.add(item.getDocument().getId());
                    }
                }
            }
            if (order.getDocument() != null) {
                allShopDocIds.add(order.getDocument().getId());
            }
        }

        int deletedCount = 0;
        int skippedActiveCount = 0;

        for (UUID docId : allShopDocIds) {
            try {
                List<PrintOrder> docOrders = printOrderRepository.findOrdersByShopIdAndDocumentId(shopId, docId);
                boolean isProcessing = docOrders.stream().anyMatch(o -> o.getPrintStatus() == PrintStatus.PENDING || o.getPrintStatus() == PrintStatus.PRINTING);
                if (isProcessing) {
                    skippedActiveCount++;
                    log.info("[AUDIT] DeleteAll skipped active document '{}'", docId);
                    continue;
                }

                Document document = documentRepository.findById(docId).orElse(null);
                if (document != null) {
                    String storedFileName = document.getStoredFileName();
                    // M-06: filesystem delete first — only touch DB refs when it succeeds.
                    if (!fileStorageService.deletePhysicalFile(storedFileName)) {
                        log.error("[AUDIT] DeleteAll aborted for document {}: filesystem delete failed, DB row preserved", docId);
                        continue;
                    }
                    orderItemRepository.nullifyDocumentReference(docId);
                    printOrderRepository.nullifyDocumentReference(docId);
                    documentRepository.deleteDocumentByIdDirect(docId);
                    deletedCount++;
                }
            } catch (Exception e) {
                log.error("[AUDIT] DeleteAll error on document '{}': {}", docId, e.getMessage());
            }
        }

        log.info("[AUDIT] DELETE ALL shop documents executed by admin '{}' (shop '{}'): {} deleted, {} skipped (active) at {}",
                userId, shopId, deletedCount, skippedActiveCount, LocalDateTime.now());

        Map<String, Object> result = new HashMap<>();
        result.put("deletedCount", deletedCount);
        result.put("skippedActiveCount", skippedActiveCount);
        result.put("totalCandidateDocuments", allShopDocIds.size());
        return result;
    }
}
