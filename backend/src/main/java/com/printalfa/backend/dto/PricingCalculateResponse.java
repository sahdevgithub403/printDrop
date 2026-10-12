package com.printalfa.backend.dto;

import java.math.BigDecimal;

public class PricingCalculateResponse {
    private int totalDocumentPages;
    private int calculatedPages;
    private int copies;
    private BigDecimal unitPricePerPage;
    private BigDecimal totalPrice;
    private String breakdown;

    public PricingCalculateResponse() {}

    public PricingCalculateResponse(int totalDocumentPages, int calculatedPages, int copies, BigDecimal unitPricePerPage, BigDecimal totalPrice, String breakdown) {
        this.totalDocumentPages = totalDocumentPages;
        this.calculatedPages = calculatedPages;
        this.copies = copies;
        this.unitPricePerPage = unitPricePerPage;
        this.totalPrice = totalPrice;
        this.breakdown = breakdown;
    }

    public int getTotalDocumentPages() { return totalDocumentPages; }
    public void setTotalDocumentPages(int totalDocumentPages) { this.totalDocumentPages = totalDocumentPages; }

    public int getCalculatedPages() { return calculatedPages; }
    public void setCalculatedPages(int calculatedPages) { this.calculatedPages = calculatedPages; }

    public int getCopies() { return copies; }
    public void setCopies(int copies) { this.copies = copies; }

    public BigDecimal getUnitPricePerPage() { return unitPricePerPage; }
    public void setUnitPricePerPage(BigDecimal unitPricePerPage) { this.unitPricePerPage = unitPricePerPage; }

    public BigDecimal getTotalPrice() { return totalPrice; }
    public void setTotalPrice(BigDecimal totalPrice) { this.totalPrice = totalPrice; }

    public String getBreakdown() { return breakdown; }
    public void setBreakdown(String breakdown) { this.breakdown = breakdown; }
}
