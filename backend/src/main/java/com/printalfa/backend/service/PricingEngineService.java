package com.printalfa.backend.service;

import com.printalfa.backend.dto.PricingCalculateRequest;
import com.printalfa.backend.dto.PricingCalculateResponse;
import com.printalfa.backend.entity.Document;
import com.printalfa.backend.entity.ShopPricing;
import com.printalfa.backend.enums.ColorMode;
import com.printalfa.backend.enums.PaperSize;
import com.printalfa.backend.enums.PrintSide;
import com.printalfa.backend.repository.DocumentRepository;
import com.printalfa.backend.repository.ShopPricingRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

@Service
public class PricingEngineService {

    private final ShopPricingRepository shopPricingRepository;
    private final DocumentRepository documentRepository;

    public PricingEngineService(ShopPricingRepository shopPricingRepository, DocumentRepository documentRepository) {
        this.shopPricingRepository = shopPricingRepository;
        this.documentRepository = documentRepository;
    }

    public PricingCalculateResponse calculatePrice(PricingCalculateRequest request) {
        Document document = documentRepository.findById(request.getDocumentId())
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));

        ShopPricing pricing = shopPricingRepository.findByShopId(request.getShopId())
                .orElseThrow(() -> new IllegalArgumentException("Shop pricing configuration not found"));

        int totalDocPages = document.getPageCount();
        int pagesToPrint = parsePageRange(request.getPageRange(), totalDocPages);
        // L-03: cap copies server-side so amount math cannot be abused into overflow.
        int copies = Math.max(1, Math.min(request.getCopies(), 100));

        BigDecimal ratePerPage;
        if (request.getPrintType() == com.printalfa.backend.enums.PrintType.PASSPORT_PHOTO) {
            ratePerPage = pricing.getPassportPrice();
        } else {
            ratePerPage = getRatePerPage(pricing, request.getColorMode(), request.getPaperSize(), request.getPrintSide());
        }

        // For double side printing, charge by physical paper sheets (each sheet contains 2 pages)
        int unitsToCharge = (request.getPrintSide() == PrintSide.DOUBLE)
                ? (int) Math.ceil(pagesToPrint / 2.0)
                : pagesToPrint;

        // L-03: long math — detect overflow instead of silently wrapping.
        BigDecimal total = ratePerPage.multiply(BigDecimal.valueOf(Math.multiplyExact((long) unitsToCharge, (long) copies)));

        String specDesc = String.format("%s • %s • %s • %s",
                request.getColorMode() == ColorMode.BW ? "B&W" : "Color",
                request.getPaperSize(),
                request.getPrintSide() == PrintSide.SINGLE ? "Single Side" : "Double Side",
                request.getPrintType());

        String unitLabel = request.getPrintSide() == PrintSide.DOUBLE ? "Sheets" : "Pages";
        String breakdown = String.format("%d %s × ₹%s × %d Copies = ₹%s (%s)",
                unitsToCharge, unitLabel, ratePerPage.toPlainString(), copies, total.toPlainString(), specDesc);

        return new PricingCalculateResponse(
                totalDocPages,
                pagesToPrint,
                copies,
                ratePerPage,
                total,
                breakdown
        );
    }

    public BigDecimal getRatePerPage(ShopPricing pricing, ColorMode colorMode, PaperSize paperSize, PrintSide printSide) {
        if (paperSize == PaperSize.A4) {
            if (colorMode == ColorMode.BW) {
                return printSide == PrintSide.SINGLE ? pricing.getBwA4Single() : pricing.getBwA4Double();
            } else {
                return printSide == PrintSide.SINGLE ? pricing.getColorA4Single() : pricing.getColorA4Double();
            }
        } else { // A3
            if (colorMode == ColorMode.BW) {
                return printSide == PrintSide.SINGLE ? pricing.getBwA3Single() : pricing.getBwA3Double();
            } else {
                return printSide == PrintSide.SINGLE ? pricing.getColorA3Single() : pricing.getColorA3Double();
            }
        }
    }

    public int parsePageRange(String pageRange, int totalPages) {
        if (pageRange == null || pageRange.trim().isEmpty() || "ALL".equalsIgnoreCase(pageRange.trim())) {
            return totalPages;
        }

        try {
            Set<Integer> uniquePages = new HashSet<>();
            String[] parts = pageRange.split(",");
            for (String part : parts) {
                part = part.trim();
                if (part.contains("-")) {
                    String[] range = part.split("-");
                    if (range.length == 2) {
                        int start = Integer.parseInt(range[0].trim());
                        int end = Integer.parseInt(range[1].trim());
                        int min = Math.min(start, end);
                        int max = Math.max(start, end);
                        for (int i = min; i <= max; i++) {
                            if (i >= 1 && i <= totalPages) {
                                uniquePages.add(i);
                            }
                        }
                    }
                } else if (!part.isEmpty()) {
                    int p = Integer.parseInt(part);
                    if (p >= 1 && p <= totalPages) {
                        uniquePages.add(p);
                    }
                }
            }
            return uniquePages.isEmpty() ? totalPages : uniquePages.size();
        } catch (Exception e) {
            return totalPages;
        }
    }
}
