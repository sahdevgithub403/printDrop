package com.printalfa.backend.repository;

import com.printalfa.backend.entity.OrderItem;
import org.springframework.data.jpa.repository.JpaRepository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OrderItemRepository extends JpaRepository<OrderItem, UUID> {
    List<OrderItem> findByOrderId(UUID orderId);
    Optional<OrderItem> findByIdAndOrderShopId(UUID id, UUID shopId);
    List<OrderItem> findByDocumentId(UUID documentId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE OrderItem i SET i.document = null WHERE i.document.id = :documentId")
    void nullifyDocumentReference(@Param("documentId") UUID documentId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE OrderItem i SET i.document = null WHERE i.document.id IN :documentIds")
    void nullifyDocumentReferencesBulk(@Param("documentIds") List<UUID> documentIds);
}
