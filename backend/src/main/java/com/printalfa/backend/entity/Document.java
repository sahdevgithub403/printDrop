package com.printalfa.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "documents")
@Getter
@Setter
@AllArgsConstructor
@Builder
public class Document {

    public Document() {}

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String originalFileName;

    @Column(nullable = false, unique = true)
    private String storedFileName;

    private String contentType;
    private long fileSize;
    private int pageCount;
    private String filePath;

    // Shop that owns this upload (set when uploaded with shop context).
    // Nullable for backward compatibility with pre-existing rows.
    private UUID shopId;

    // Document Studio: id of the source document this row was derived from
    // (edited copy). Null for original uploads. Forms the version lineage
    // used to list Original/Edited versions of an order item's document.
    // PROD NOTE: no Flyway in this project (dev/test use ddl-auto:update,
    // prod uses ddl-auto:validate) — before deploying, run once:
    //   ALTER TABLE documents ADD COLUMN parent_document_id UUID;
    private UUID parentDocumentId;

    @Column(nullable = false, updatable = false)
    private LocalDateTime uploadedAt;

    @PrePersist
    protected void onCreate() {
        this.uploadedAt = LocalDateTime.now();
    }

    public Document(String originalFileName, String storedFileName, String contentType, long fileSize, int pageCount, String filePath) {
        this.originalFileName = originalFileName;
        this.storedFileName = storedFileName;
        this.contentType = contentType;
        this.fileSize = fileSize;
        this.pageCount = pageCount;
        this.filePath = filePath;
    }
}
