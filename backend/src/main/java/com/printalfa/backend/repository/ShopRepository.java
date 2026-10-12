package com.printalfa.backend.repository;

import com.printalfa.backend.entity.Shop;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface ShopRepository extends JpaRepository<Shop, UUID> {
    Optional<Shop> findBySlug(String slug);
    Optional<Shop> findByApiKey(String apiKey);
    boolean existsBySlug(String slug);
}
