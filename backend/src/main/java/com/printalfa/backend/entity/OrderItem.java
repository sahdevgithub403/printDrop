package com.printalfa.backend.entity;

import com.printalfa.backend.enums.*;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "order_items")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OrderItem {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private PrintOrder order;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "document_id", nullable = true)
    private Document document;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PrintType printType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ColorMode colorMode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaperSize paperSize;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PrintSide printSide;

    @Column(nullable = false)
    private String pageRange;

    @Column(nullable = false)
    private int copies;

    @Column(nullable = false)
    private int calculatedPages;

    @Column(name = "unit_price", nullable = false)
    private BigDecimal unitPrice;

    @Column(name = "item_price", nullable = false)
    private BigDecimal itemPrice;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PrintStatus printStatus;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (this.printStatus == null) {
            this.printStatus = PrintStatus.PENDING;
        }
        if (this.pageRange == null || this.pageRange.trim().isEmpty()) {
            this.pageRange = "ALL";
        }
        if (this.copies < 1) {
            this.copies = 1;
        }
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
