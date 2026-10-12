package com.printalfa.backend.dto;

import java.time.LocalDateTime;
import java.util.UUID;

public class DocumentDTO {
    private UUID id;
    private String originalFileName;
    private String contentType;
    private long fileSize;
    private int pageCount;
    private LocalDateTime uploadedAt;
    private UUID parentDocumentId;
    private boolean current;

    public DocumentDTO() {}

    public DocumentDTO(UUID id, String originalFileName, String contentType, long fileSize, int pageCount, LocalDateTime uploadedAt) {
        this.id = id;
        this.originalFileName = originalFileName;
        this.contentType = contentType;
        this.fileSize = fileSize;
        this.pageCount = pageCount;
        this.uploadedAt = uploadedAt;
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public String getOriginalFileName() { return originalFileName; }
    public void setOriginalFileName(String originalFileName) { this.originalFileName = originalFileName; }

    public String getContentType() { return contentType; }
    public void setContentType(String contentType) { this.contentType = contentType; }

    public long getFileSize() { return fileSize; }
    public void setFileSize(long fileSize) { this.fileSize = fileSize; }

    public int getPageCount() { return pageCount; }
    public void setPageCount(int pageCount) { this.pageCount = pageCount; }

    public LocalDateTime getUploadedAt() { return uploadedAt; }
    public void setUploadedAt(LocalDateTime uploadedAt) { this.uploadedAt = uploadedAt; }

    public UUID getParentDocumentId() { return parentDocumentId; }
    public void setParentDocumentId(UUID parentDocumentId) { this.parentDocumentId = parentDocumentId; }

    public boolean isCurrent() { return current; }
    public void setCurrent(boolean current) { this.current = current; }
}
