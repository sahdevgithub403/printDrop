package com.printalfa.backend.service;

import com.printalfa.backend.dto.ShopDTO;
import com.printalfa.backend.dto.ShopPricingDTO;
import com.printalfa.backend.entity.Shop;
import com.printalfa.backend.entity.ShopPricing;
import com.printalfa.backend.repository.ShopPricingRepository;
import com.printalfa.backend.repository.ShopRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class ShopService {

    private final ShopRepository shopRepository;
    private final ShopPricingRepository shopPricingRepository;
    private final com.printalfa.backend.repository.UserRepository userRepository;

    public ShopService(ShopRepository shopRepository, ShopPricingRepository shopPricingRepository, com.printalfa.backend.repository.UserRepository userRepository) {
        this.shopRepository = shopRepository;
        this.shopPricingRepository = shopPricingRepository;
        this.userRepository = userRepository;
    }

    @Transactional
    public ShopDTO createShop(UUID userId, ShopDTO request) {
        com.printalfa.backend.entity.User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        if (user.getShop() != null) {
            throw new IllegalArgumentException("User already has a shop");
        }

        if (request.getName() == null || request.getName().trim().isEmpty()) {
            throw new IllegalArgumentException("Shop name is required");
        }

        String baseSlug = request.getName().toLowerCase().replaceAll("[^a-z0-9]+", "-");
        String slug = baseSlug;
        int counter = 1;
        while (shopRepository.existsBySlug(slug)) {
            slug = baseSlug + "-" + counter++;
        }

        Shop shop = new Shop();
        shop.setName(request.getName());
        shop.setSlug(slug);
        shop.setOwnerName(request.getOwnerName());
        shop.setPhone(request.getPhone());
        shop.setAddress(request.getAddress());
        shop.setCity(request.getCity());
        shop.setState(request.getState());
        shop.setPincode(request.getPincode());
        shop.setLogoUrl(request.getLogoUrl());

        Shop savedShop = shopRepository.save(shop);

        ShopPricing pricing = new ShopPricing(
                savedShop,
                new java.math.BigDecimal("2.00"),  // BW A4 Single
                new java.math.BigDecimal("3.00"),  // BW A4 Double
                new java.math.BigDecimal("10.00"), // Color A4 Single
                new java.math.BigDecimal("15.00"), // Color A4 Double
                new java.math.BigDecimal("5.00"),  // BW A3 Single
                new java.math.BigDecimal("8.00"),  // BW A3 Double
                new java.math.BigDecimal("20.00"), // Color A3 Single
                new java.math.BigDecimal("35.00"), // Color A3 Double
                new java.math.BigDecimal("50.00")  // Passport Price
        );
        shopPricingRepository.save(pricing);

        user.setShop(savedShop);
        userRepository.save(user);

        // C-04: the API key is disclosed ONLY here (creation) and via explicit regeneration.
        return mapShopToDTO(savedShop);
    }

    /**
     * Rotates the shop agent API key. Existing keys keep working until rotated;
     * rotation immediately replaces the stored key. The new key is returned once —
     * callers must persist it, as GET endpoints never disclose it.
     *
     * Follow-up: store only a hash of the API key and compare hashes in the
     * auth filter (requires filter + repository changes; current plaintext
     * comparison is kept for backward compatibility with existing keys).
     */
    @Transactional
    public ShopDTO regenerateApiKey(UUID shopId) {
        if (shopId == null) {
            throw new IllegalArgumentException("No shop associated with this account yet. Please complete shop setup.");
        }
        Shop shop = shopRepository.findById(shopId)
                .orElseThrow(() -> new IllegalArgumentException("Shop not found"));
        shop.setApiKey("pa_live_" + UUID.randomUUID().toString().replace("-", ""));
        Shop saved = shopRepository.save(shop);
        return mapShopToDTO(saved);
    }

    @Transactional(readOnly = true)
    public ShopDTO getShopBySlug(String slug) {
        Shop shop = shopRepository.findBySlug(slug)
                .orElseThrow(() -> new IllegalArgumentException("Shop not found with slug: " + slug));
        ShopDTO dto = mapShopToDTO(shop);
        dto.setApiKey(null); // Never leak API key on public endpoints
        return dto;
    }

    @Transactional(readOnly = true)
    public ShopDTO getShopById(UUID shopId) {
        if (shopId == null) {
            throw new IllegalArgumentException("No shop associated with this account yet. Please complete shop setup.");
        }
        Shop shop = shopRepository.findById(shopId)
                .orElseThrow(() -> new IllegalArgumentException("Shop not found"));
        // C-04: never disclose the API key on read endpoints.
        ShopDTO dto = mapShopToDTO(shop);
        dto.setApiKey(null);
        return dto;
    }

    @Transactional
    public ShopDTO updateShop(UUID shopId, ShopDTO request) {
        if (shopId == null) {
            throw new IllegalArgumentException("No shop associated with this account yet. Please complete shop setup.");
        }
        Shop shop = shopRepository.findById(shopId)
                .orElseThrow(() -> new IllegalArgumentException("Shop not found"));

        if (request.getName() != null) {
            if (request.getName().trim().isEmpty()) {
                throw new IllegalArgumentException("Shop name must not be blank");
            }
            shop.setName(request.getName());
        }
        if (request.getAddress() != null) shop.setAddress(request.getAddress());
        if (request.getPhone() != null) shop.setPhone(request.getPhone());
        if (request.getLogoUrl() != null) shop.setLogoUrl(request.getLogoUrl());
        if (request.getOwnerName() != null) shop.setOwnerName(request.getOwnerName());
        if (request.getCity() != null) shop.setCity(request.getCity());
        if (request.getState() != null) shop.setState(request.getState());
        if (request.getPincode() != null) shop.setPincode(request.getPincode());
        if (request.getIsOpen() != null) shop.setIsOpen(request.getIsOpen());

        Shop updated = shopRepository.save(shop);
        ShopDTO dto = mapShopToDTO(updated);
        // C-04: updates never disclose the API key.
        dto.setApiKey(null);
        return dto;
    }

    @Transactional(readOnly = true)
    public ShopPricingDTO getShopPricing(UUID shopId) {
        ShopPricing pricing = shopPricingRepository.findByShopId(shopId)
                .orElseThrow(() -> new IllegalArgumentException("Pricing not found for shop"));
        return mapPricingToDTO(pricing);
    }

    @Transactional
    public ShopPricingDTO updateShopPricing(UUID shopId, ShopPricingDTO request) {
        ShopPricing pricing = shopPricingRepository.findByShopId(shopId)
                .orElseThrow(() -> new IllegalArgumentException("Pricing not found for shop"));

        // M-03/M-07: reject negative pricing values server-side.
        rejectNegative(request.getBwA4Single(), "bwA4Single");
        rejectNegative(request.getBwA4Double(), "bwA4Double");
        rejectNegative(request.getColorA4Single(), "colorA4Single");
        rejectNegative(request.getColorA4Double(), "colorA4Double");
        rejectNegative(request.getBwA3Single(), "bwA3Single");
        rejectNegative(request.getBwA3Double(), "bwA3Double");
        rejectNegative(request.getColorA3Single(), "colorA3Single");
        rejectNegative(request.getColorA3Double(), "colorA3Double");
        rejectNegative(request.getPassportPrice(), "passportPrice");

        if (request.getBwA4Single() != null) pricing.setBwA4Single(request.getBwA4Single());
        if (request.getBwA4Double() != null) pricing.setBwA4Double(request.getBwA4Double());
        if (request.getColorA4Single() != null) pricing.setColorA4Single(request.getColorA4Single());
        if (request.getColorA4Double() != null) pricing.setColorA4Double(request.getColorA4Double());
        if (request.getBwA3Single() != null) pricing.setBwA3Single(request.getBwA3Single());
        if (request.getBwA3Double() != null) pricing.setBwA3Double(request.getBwA3Double());
        if (request.getColorA3Single() != null) pricing.setColorA3Single(request.getColorA3Single());
        if (request.getColorA3Double() != null) pricing.setColorA3Double(request.getColorA3Double());
        if (request.getPassportPrice() != null) pricing.setPassportPrice(request.getPassportPrice());

        ShopPricing updated = shopPricingRepository.save(pricing);
        return mapPricingToDTO(updated);
    }

    private static void rejectNegative(java.math.BigDecimal value, String field) {
        if (value != null && value.signum() < 0) {
            throw new IllegalArgumentException("Pricing field '" + field + "' must not be negative");
        }
    }

    public ShopDTO mapShopToDTO(Shop shop) {
        ShopDTO dto = new ShopDTO(shop.getId(), shop.getName(), shop.getSlug(), shop.getAddress(), shop.getPhone(), shop.getLogoUrl(), shop.getApiKey(), shop.getOwnerName(), shop.getCity(), shop.getState(), shop.getPincode());
        dto.setIsOpen(shop.getIsOpen() != null ? shop.getIsOpen() : true);
        return dto;
    }

    public ShopPricingDTO mapPricingToDTO(ShopPricing pricing) {
        ShopPricingDTO dto = new ShopPricingDTO();
        dto.setId(pricing.getId());
        dto.setShopId(pricing.getShop().getId());
        dto.setBwA4Single(pricing.getBwA4Single());
        dto.setBwA4Double(pricing.getBwA4Double());
        dto.setColorA4Single(pricing.getColorA4Single());
        dto.setColorA4Double(pricing.getColorA4Double());
        dto.setBwA3Single(pricing.getBwA3Single());
        dto.setBwA3Double(pricing.getBwA3Double());
        dto.setColorA3Single(pricing.getColorA3Single());
        dto.setColorA3Double(pricing.getColorA3Double());
        dto.setPassportPrice(pricing.getPassportPrice());
        return dto;
    }
}
