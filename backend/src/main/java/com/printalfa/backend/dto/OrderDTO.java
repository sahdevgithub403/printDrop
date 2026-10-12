package com.printalfa.backend.dto;

import com.printalfa.backend.enums.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class OrderDTO {
    private UUID id;
    private String orderNumber;
    private UUID publicToken;
    private UUID shopId;
    private String shopName;
    private List<OrderItemDTO> items = new ArrayList<>();
    private BigDecimal totalPrice;
    private PaymentMethod paymentMethod;
    private PaymentStatus paymentStatus;
    private PrintStatus printStatus;
    private String customerName;
    private String customerPhone;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    private String razorpayOrderId;
    private String razorpayPaymentId;

    // Legacy fields for backwards compatibility with single-item clients
    private DocumentDTO document;
    private PrintType printType;
    private ColorMode colorMode;
    private PaperSize paperSize;
    private PrintSide printSide;
    private String pageRange;
    private int copies;
    private int calculatedPages;

    public OrderDTO() {}

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public String getOrderNumber() { return orderNumber; }
    public void setOrderNumber(String orderNumber) { this.orderNumber = orderNumber; }

    public UUID getPublicToken() { return publicToken; }
    public void setPublicToken(UUID publicToken) { this.publicToken = publicToken; }

    public UUID getShopId() { return shopId; }
    public void setShopId(UUID shopId) { this.shopId = shopId; }

    public String getShopName() { return shopName; }
    public void setShopName(String shopName) { this.shopName = shopName; }

    public List<OrderItemDTO> getItems() { return items; }
    public void setItems(List<OrderItemDTO> items) { this.items = items; }

    public BigDecimal getTotalPrice() { return totalPrice; }
    public void setTotalPrice(BigDecimal totalPrice) { this.totalPrice = totalPrice; }

    public PaymentMethod getPaymentMethod() { return paymentMethod; }
    public void setPaymentMethod(PaymentMethod paymentMethod) { this.paymentMethod = paymentMethod; }

    public PaymentStatus getPaymentStatus() { return paymentStatus; }
    public void setPaymentStatus(PaymentStatus paymentStatus) { this.paymentStatus = paymentStatus; }

    public PrintStatus getPrintStatus() { return printStatus; }
    public void setPrintStatus(PrintStatus printStatus) { this.printStatus = printStatus; }

    public String getCustomerName() { return customerName; }
    public void setCustomerName(String customerName) { this.customerName = customerName; }

    public String getCustomerPhone() { return customerPhone; }
    public void setCustomerPhone(String customerPhone) { this.customerPhone = customerPhone; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }

    public String getRazorpayOrderId() { return razorpayOrderId; }
    public void setRazorpayOrderId(String razorpayOrderId) { this.razorpayOrderId = razorpayOrderId; }

    public String getRazorpayPaymentId() { return razorpayPaymentId; }
    public void setRazorpayPaymentId(String razorpayPaymentId) { this.razorpayPaymentId = razorpayPaymentId; }

    public DocumentDTO getDocument() { return document; }
    public void setDocument(DocumentDTO document) { this.document = document; }

    public PrintType getPrintType() { return printType; }
    public void setPrintType(PrintType printType) { this.printType = printType; }

    public ColorMode getColorMode() { return colorMode; }
    public void setColorMode(ColorMode colorMode) { this.colorMode = colorMode; }

    public PaperSize getPaperSize() { return paperSize; }
    public void setPaperSize(PaperSize paperSize) { this.paperSize = paperSize; }

    public PrintSide getPrintSide() { return printSide; }
    public void setPrintSide(PrintSide printSide) { this.printSide = printSide; }

    public String getPageRange() { return pageRange; }
    public void setPageRange(String pageRange) { this.pageRange = pageRange; }

    public int getCopies() { return copies; }
    public void setCopies(int copies) { this.copies = copies; }

    public int getCalculatedPages() { return calculatedPages; }
    public void setCalculatedPages(int calculatedPages) { this.calculatedPages = calculatedPages; }
}
