package com.printalfa.backend.repository;

import com.printalfa.backend.entity.ShopPricing;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface ShopPricingRepository extends JpaRepository<ShopPricing, UUID> {
    Optional<ShopPricing> findByShopId(UUID shopId);
}
