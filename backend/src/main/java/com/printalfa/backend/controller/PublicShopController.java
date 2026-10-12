package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.ShopDTO;
import com.printalfa.backend.service.ShopService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/public/shops")
public class PublicShopController {

    private final ShopService shopService;

    public PublicShopController(ShopService shopService) {
        this.shopService = shopService;
    }

    @GetMapping("/{slug}")
    public ResponseEntity<ApiResponse<ShopDTO>> getShopBySlug(@PathVariable String slug) {
        ShopDTO shop = shopService.getShopBySlug(slug);
        return ResponseEntity.ok(ApiResponse.success(shop));
    }
}
