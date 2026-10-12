package com.printalfa.backend.controller;

import com.printalfa.backend.dto.AdminDocumentDTO;
import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.entity.Document;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import com.printalfa.backend.security.UserPrincipal;
import com.printalfa.backend.service.AdminDocumentService;
import com.printalfa.backend.service.FileStorageService;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/documents")
public class AdminDocumentController {

    private final AdminDocumentService adminDocumentService;
    private final FileStorageService fileStorageService;
    private final DocumentRepository documentRepository;
    private final PrintOrderRepository printOrderRepository;

    public AdminDocumentController(AdminDocumentService adminDocumentService,
                                   FileStorageService fileStorageService,
                                   DocumentRepository documentRepository,
                                   PrintOrderRepository printOrderRepository) {
        this.adminDocumentService = adminDocumentService;
        this.fileStorageService = fileStorageService;
        this.documentRepository = documentRepository;
        this.printOrderRepository = printOrderRepository;
    }

    private static boolean isSuperAdmin(UserPrincipal userPrincipal) {
        return userPrincipal != null && userPrincipal.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_SUPER_ADMIN"));
    }

    // M-06: downloads are served as attachments with RFC5987-encoded sanitized filenames.
    static String buildAttachmentHeader(String originalFileName) {
        String safe = originalFileName != null ? originalFileName.replaceAll("[\\r\\n\"]", "_") : "document";
        try {
            String encoded = java.net.URLEncoder.encode(safe, java.nio.charset.StandardCharsets.UTF_8)
                    .replace("+", "%20");
            return "attachment; filename=\"" + safe.replace("\"", "") + "\"; filename*=UTF-8''" + encoded;
        } catch (Exception e) {
            return "attachment; filename=\"document\"";
        }
    }

    @GetMapping
    public ResponseEntity<ApiResponse<Page<AdminDocumentDTO>>> getShopDocuments(
            @RequestParam(required = false) String search,
            @RequestParam(required = false, defaultValue = "ALL") String type,
            @RequestParam(required = false, defaultValue = "NEWEST") String sort,
            @RequestParam(required = false, defaultValue = "0") int page,
            @RequestParam(required = false, defaultValue = "25") int size,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {

        // M-01: super-admins bypass the blanket shop check (read-only ok); shop-scoped
        // queries still require an explicit shop context.
        if (userPrincipal == null || (userPrincipal.getShopId() == null && !isSuperAdmin(userPrincipal))) {
            throw new AccessDeniedException("User not authenticated or shop context missing");
        }
        if (userPrincipal.getShopId() == null) {
            throw new IllegalArgumentException("Super admin must provide shop context to list documents");
        }

        // M-06: bound page size so in-memory filtering cannot be abused into OOM.
        int boundedSize = Math.min(Math.max(1, size), 100);

        Page<AdminDocumentDTO> documents = adminDocumentService.getShopDocuments(
                userPrincipal.getShopId(), search, type, sort, page, boundedSize
        );

        return ResponseEntity.ok(ApiResponse.success(documents));
    }

    @DeleteMapping("/{documentId}")
    public ResponseEntity<ApiResponse<String>> deleteDocument(
            @PathVariable UUID documentId,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {

        if (userPrincipal == null || userPrincipal.getShopId() == null) {
            throw new AccessDeniedException("User not authenticated or shop context missing");
        }

        adminDocumentService.deleteDocument(userPrincipal.getShopId(), documentId, userPrincipal.getId());
        return ResponseEntity.ok(ApiResponse.success("Document permanently deleted", null));
    }

    /**
     * Document Studio: upload an edited copy (multipart). The original file is
     * never modified; the copy is linked to the source via parentDocumentId.
     */
    @PostMapping(value = "/upload", consumes = org.springframework.http.MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<AdminDocumentDTO>> uploadEditedCopy(
            @RequestParam("file") org.springframework.web.multipart.MultipartFile file,
            @RequestParam(value = "sourceDocumentId", required = false) UUID sourceDocumentId,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {

        if (userPrincipal == null || userPrincipal.getShopId() == null) {
            throw new AccessDeniedException("User not authenticated or shop context missing");
        }

        AdminDocumentDTO saved = adminDocumentService.uploadEditedCopy(
                userPrincipal.getShopId(), file, sourceDocumentId, userPrincipal.getId());
        return ResponseEntity.ok(ApiResponse.success("Edited copy saved", saved));
    }

    @DeleteMapping("/bulk")
    public ResponseEntity<ApiResponse<Map<String, Object>>> deleteBulkDocuments(
            @RequestBody(required = false) Map<String, Object> requestBody,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {

        if (userPrincipal == null || userPrincipal.getShopId() == null) {
            throw new AccessDeniedException("User not authenticated or shop context missing");
        }

        List<UUID> documentIds = new java.util.ArrayList<>();
        if (requestBody != null && requestBody.containsKey("documentIds")) {
            Object rawList = requestBody.get("documentIds");
            if (rawList instanceof List<?> list) {
                for (Object item : list) {
                    if (item instanceof String str && !str.trim().isEmpty()) {
                        try {
                            documentIds.add(UUID.fromString(str.trim()));
                        } catch (Exception ignored) {}
                    } else if (item instanceof UUID u) {
                        documentIds.add(u);
                    }
                }
            }
        }

        int deletedCount = adminDocumentService.deleteBulkDocuments(userPrincipal.getShopId(), documentIds, userPrincipal.getId());

        return ResponseEntity.ok(ApiResponse.success("Bulk deletion completed", Map.of("deletedCount", deletedCount)));
    }

    @DeleteMapping("/all")
    public ResponseEntity<ApiResponse<Map<String, Object>>> deleteAllShopDocuments(
            @AuthenticationPrincipal UserPrincipal userPrincipal) {

        if (userPrincipal == null || userPrincipal.getShopId() == null) {
            throw new AccessDeniedException("User not authenticated or shop context missing");
        }

        Map<String, Object> result = adminDocumentService.deleteAllShopDocuments(userPrincipal.getShopId(), userPrincipal.getId());
        return ResponseEntity.ok(ApiResponse.success("All eligible shop documents deleted", result));
    }

    @GetMapping("/{documentId}/download")
    public ResponseEntity<Resource> downloadDocument(
            @PathVariable UUID documentId,
            @AuthenticationPrincipal UserPrincipal userPrincipal) {

        if (userPrincipal == null || (userPrincipal.getShopId() == null && !isSuperAdmin(userPrincipal))) {
            throw new AccessDeniedException("User not authenticated or shop context missing");
        }

        // M-01: super-admins bypass per-shop ownership (read-only ok).
        if (!isSuperAdmin(userPrincipal)) {
            boolean hasAccess = printOrderRepository.existsByShopIdAndDocumentId(userPrincipal.getShopId(), documentId);
            if (!hasAccess) {
                throw new AccessDeniedException("Document does not belong to any orders in your shop");
            }
        }

        Document document = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));

        Resource resource = fileStorageService.loadFileAsResource(document.getStoredFileName());

        String contentType = document.getContentType();
        if (contentType == null || contentType.isEmpty()) {
            contentType = "application/octet-stream";
        }

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .header(HttpHeaders.CONTENT_DISPOSITION, buildAttachmentHeader(document.getOriginalFileName()))
                .body(resource);
    }
}
