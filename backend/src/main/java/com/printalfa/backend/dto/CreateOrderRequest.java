package com.printalfa.backend.dto;

import com.printalfa.backend.enums.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class CreateOrderRequest {
    @NotNull(message = "Shop ID is required")
    private UUID shopId;

    @NotNull(message = "Payment method is required")
    private PaymentMethod paymentMethod;

    private String customerName;
    private String customerPhone;

    // Multi-item list (nested constraints validated via @Valid)
    @Valid
    private List<CreateOrderItemRequest> items = new ArrayList<>();

    // Legacy fields for backwards compatibility
    private UUID documentId;
    private PrintType printType;
    private ColorMode colorMode;
    private PaperSize paperSize;
    private PrintSide printSide;
    private String pageRange = "ALL";
    private int copies = 1;

    public CreateOrderRequest() {}

    public UUID getShopId() { return shopId; }
    public void setShopId(UUID shopId) { this.shopId = shopId; }

    public PaymentMethod getPaymentMethod() { return paymentMethod; }
    public void setPaymentMethod(PaymentMethod paymentMethod) { this.paymentMethod = paymentMethod; }

    public String getCustomerName() { return customerName; }
    public void setCustomerName(String customerName) { this.customerName = customerName; }

    public String getCustomerPhone() { return customerPhone; }
    public void setCustomerPhone(String customerPhone) { this.customerPhone = customerPhone; }

    public List<CreateOrderItemRequest> getItems() { return items; }
    public void setItems(List<CreateOrderItemRequest> items) { this.items = items; }

    public UUID getDocumentId() { return documentId; }
    public void setDocumentId(UUID documentId) { this.documentId = documentId; }

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
}
