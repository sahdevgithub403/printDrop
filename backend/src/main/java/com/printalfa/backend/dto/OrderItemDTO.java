package com.printalfa.backend.dto;

import com.printalfa.backend.enums.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

public class OrderItemDTO {
    private UUID id;
    private UUID orderId;
    private DocumentDTO document;
    private PrintType printType;
    private ColorMode colorMode;
    private PaperSize paperSize;
    private PrintSide printSide;
    private String pageRange;
    private int copies;
    private int calculatedPages;
    private BigDecimal unitPrice;
    private BigDecimal itemPrice;
    private PrintStatus printStatus;
    private LocalDateTime createdAt;

    public OrderItemDTO() {}

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public UUID getOrderId() { return orderId; }
    public void setOrderId(UUID orderId) { this.orderId = orderId; }

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

    public BigDecimal getUnitPrice() { return unitPrice; }
    public void setUnitPrice(BigDecimal unitPrice) { this.unitPrice = unitPrice; }

    public BigDecimal getItemPrice() { return itemPrice; }
    public void setItemPrice(BigDecimal itemPrice) { this.itemPrice = itemPrice; }

    public PrintStatus getPrintStatus() { return printStatus; }
    public void setPrintStatus(PrintStatus printStatus) { this.printStatus = printStatus; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
