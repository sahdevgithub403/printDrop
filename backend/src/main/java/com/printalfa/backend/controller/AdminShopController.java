package com.printalfa.backend.controller;

import com.printalfa.backend.dto.ApiResponse;
import com.printalfa.backend.dto.ShopDTO;
import com.printalfa.backend.security.UserPrincipal;
import com.printalfa.backend.service.ShopService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin/shop")
public class AdminShopController {

    private final ShopService shopService;

    @Value("${app.customer-url:http://localhost:5173}")
    private String customerUrl;

    public AdminShopController(ShopService shopService) {
        this.shopService = shopService;
    }

    /**
     * A missing shop is a normal "setup not completed yet" state, not a server
     * error. Fail with 404 so clients route to the setup flow; never pass null
     * into repository lookups (which would 500).
     */
    private static UUID requireShopId(UserPrincipal userPrincipal) {
        if (userPrincipal == null || userPrincipal.getShopId() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "No shop associated with this account yet. Please complete shop setup.");
        }
        return userPrincipal.getShopId();
    }

    @GetMapping
    public ResponseEntity<ApiResponse<ShopDTO>> getShopProfile(@AuthenticationPrincipal UserPrincipal userPrincipal) {
        ShopDTO shop = shopService.getShopById(requireShopId(userPrincipal));
        return ResponseEntity.ok(ApiResponse.success(shop));
    }

    @PostMapping("/create")
    public ResponseEntity<ApiResponse<ShopDTO>> createShop(@AuthenticationPrincipal UserPrincipal userPrincipal,
                                                           @RequestBody ShopDTO request) {
        // C-04: the API key is disclosed ONLY in this creation response (once).
        ShopDTO newShop = shopService.createShop(userPrincipal.getId(), request);
        return ResponseEntity.ok(ApiResponse.success("Shop created successfully", newShop));
    }

    @PostMapping("/api-key/regenerate")
    public ResponseEntity<ApiResponse<ShopDTO>> regenerateApiKey(@AuthenticationPrincipal UserPrincipal userPrincipal) {
        // C-04: explicit rotation endpoint. Returns the new key once; existing key
        // keeps working until this call replaces it. GET endpoints never disclose it.
        // Follow-up: store only a hash of the API key (see ShopService.regenerateApiKey).
        ShopDTO rotated = shopService.regenerateApiKey(requireShopId(userPrincipal));
        return ResponseEntity.ok(ApiResponse.success("API key regenerated successfully", rotated));
    }

    @PutMapping
    public ResponseEntity<ApiResponse<ShopDTO>> updateShopProfile(
            @AuthenticationPrincipal UserPrincipal userPrincipal,
            @RequestBody ShopDTO request) {
        
        ShopDTO updated = shopService.updateShop(requireShopId(userPrincipal), request);
        return ResponseEntity.ok(ApiResponse.success("Shop profile updated successfully", updated));
    }

    @GetMapping("/qr")
    public ResponseEntity<ApiResponse<Map<String, String>>> getShopQR(@AuthenticationPrincipal UserPrincipal userPrincipal) {
        ShopDTO shop = shopService.getShopById(requireShopId(userPrincipal));
        Map<String, String> data = new HashMap<>();
        data.put("shopSlug", shop.getSlug());
        data.put("shopName", shop.getName());
        data.put("shopUrl", "/shop/" + shop.getSlug());
        data.put("fullShopUrl", customerUrl + "/shop/" + shop.getSlug());
        return ResponseEntity.ok(ApiResponse.success(data));
    }
}
