package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.PricingCalculateRequest;
import com.printalfa.backend.dto.PricingCalculateResponse;
import com.printalfa.backend.service.PricingEngineService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/public/pricing")
public class PublicPricingController {

    private final PricingEngineService pricingEngineService;

    public PublicPricingController(PricingEngineService pricingEngineService) {
        this.pricingEngineService = pricingEngineService;
    }

    @PostMapping("/calculate")
    public ResponseEntity<ApiResponse<PricingCalculateResponse>> calculatePrice(@Valid @RequestBody PricingCalculateRequest request) {
        PricingCalculateResponse response = pricingEngineService.calculatePrice(request);
        return ResponseEntity.ok(ApiResponse.success(response));
    }
}
