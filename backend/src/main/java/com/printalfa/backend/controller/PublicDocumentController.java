package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.DocumentDTO;
import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.repository.ShopRepository;
import com.printalfa.backend.service.FileStorageService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

@RestController
@RequestMapping("/api/public/documents")
public class PublicDocumentController {

    private final FileStorageService fileStorageService;
    private final ShopRepository shopRepository;

    public PublicDocumentController(FileStorageService fileStorageService, ShopRepository shopRepository) {
        this.fileStorageService = fileStorageService;
        this.shopRepository = shopRepository;
    }

    @PostMapping("/upload")
    public ResponseEntity<ApiResponse<DocumentDTO>> uploadDocument(
            @RequestParam("file") MultipartFile file,
            // C-08: optional shop context binding; createOrder rejects docs bound to another shop.
            @RequestParam(value = "shopId", required = false) UUID shopId,
            @RequestParam(value = "shopSlug", required = false) String shopSlug) {
        UUID boundShopId = shopId;
        if (boundShopId == null && shopSlug != null && !shopSlug.trim().isEmpty()) {
            boundShopId = shopRepository.findBySlug(shopSlug.trim()).map(Shop::getId).orElse(null);
        }
        Document doc = fileStorageService.uploadFile(file, boundShopId);
        DocumentDTO dto = new DocumentDTO(
                doc.getId(),
                doc.getOriginalFileName(),
                doc.getContentType(),
                doc.getFileSize(),
                doc.getPageCount(),
                doc.getUploadedAt()
        );
        return ResponseEntity.ok(ApiResponse.success("Document uploaded successfully", dto));
    }
}
