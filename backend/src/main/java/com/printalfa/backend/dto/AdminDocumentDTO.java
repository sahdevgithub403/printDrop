package com.printalfa.backend.dto;

import com.printalfa.backend.enums.PrintStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AdminDocumentDTO {
    private UUID id;
    private String originalFileName;
    private String contentType;
    private long fileSize;
    private int pageCount;
    private LocalDateTime uploadedAt;
    private UUID orderId;
    private String orderNumber;
    private String customerName;
    private PrintStatus orderPrintStatus;
    private boolean canDelete;
    private boolean isProcessing;
    private UUID parentDocumentId;
}
