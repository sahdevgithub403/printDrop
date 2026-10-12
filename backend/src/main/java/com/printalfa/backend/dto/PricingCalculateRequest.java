package com.printalfa.backend.dto;

import com.printalfa.backend.enums.*;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public class PricingCalculateRequest {
    @NotNull(message = "Shop ID is required")
    private UUID shopId;

    @NotNull(message = "Document ID is required")
    private UUID documentId;

    @NotNull(message = "Print type is required")
    private PrintType printType;

    @NotNull(message = "Color mode is required")
    private ColorMode colorMode;

    @NotNull(message = "Paper size is required")
    private PaperSize paperSize;

    @NotNull(message = "Print side is required")
    private PrintSide printSide;

    private String pageRange = "ALL";

    @Min(value = 1, message = "Copies must be at least 1")
    private int copies = 1;

    public PricingCalculateRequest() {}

    public UUID getShopId() { return shopId; }
    public void setShopId(UUID shopId) { this.shopId = shopId; }

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
