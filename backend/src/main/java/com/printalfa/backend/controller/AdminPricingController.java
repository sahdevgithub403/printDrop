package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.ShopPricingDTO;
import com.printalfa.backend.security.UserPrincipal;
import com.printalfa.backend.service.ShopService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/pricing")
public class AdminPricingController {

    private final ShopService shopService;

    public AdminPricingController(ShopService shopService) {
        this.shopService = shopService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<ShopPricingDTO>> getPricing(@AuthenticationPrincipal UserPrincipal userPrincipal) {
        ShopPricingDTO pricing = shopService.getShopPricing(userPrincipal.getShopId());
        return ResponseEntity.ok(ApiResponse.success(pricing));
    }

    @PutMapping
    public ResponseEntity<ApiResponse<ShopPricingDTO>> updatePricing(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @RequestBody ShopPricingDTO request) {
        
        ShopPricingDTO updated = shopService.updateShopPricing(userPrincipal.getShopId(), request);
        return ResponseEntity.ok(ApiResponse.success("Pricing updated successfully", updated));
    }
}
