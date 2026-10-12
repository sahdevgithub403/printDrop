package com.printalfa.backend.entity;

import com.printalfa.backend.enums.*;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "print_orders")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PrintOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String orderNumber;

    @Column(nullable = false, unique = true)
    private UUID publicToken;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shop_id", nullable = false)
    private Shop shop;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<OrderItem> items = new ArrayList<>();

    // Legacy fields made nullable for backwards compatibility with single-file database records
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "document_id", nullable = true)
    private Document document;

    @Enumerated(EnumType.STRING)
    @Column(nullable = true)
    private PrintType printType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = true)
    private ColorMode colorMode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = true)
    private PaperSize paperSize;

    @Enumerated(EnumType.STRING)
    @Column(nullable = true)
    private PrintSide printSide;

    @Column(nullable = true)
    private String pageRange;

    @Column(nullable = true)
    private Integer copies;

    @Column(nullable = true)
    private Integer calculatedPages;

    @Column(nullable = false)
    private BigDecimal totalPrice;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaymentMethod paymentMethod;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaymentStatus paymentStatus;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PrintStatus printStatus;

    @Column(name = "customer_name")
    private String customerName;

    @Column(name = "customer_phone")
    private String customerPhone;

    @Column(name = "razorpay_order_id", unique = true)
    private String razorpayOrderId;

    @Column(name = "razorpay_payment_id", unique = true)
    private String razorpayPaymentId;

    @Column(name = "razorpay_signature")
    private String razorpaySignature;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (this.publicToken == null) {
            this.publicToken = UUID.randomUUID();
        }
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public void addItem(OrderItem item) {
        items.add(item);
        item.setOrder(this);
    }

    public void removeItem(OrderItem item) {
        items.remove(item);
        item.setOrder(null);
    }
}
