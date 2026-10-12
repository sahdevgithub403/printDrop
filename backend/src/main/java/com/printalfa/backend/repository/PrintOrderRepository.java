package com.printalfa.backend.repository;

import com.printalfa.backend.entity.PrintOrder;
import com.printalfa.backend.enums.PrintStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PrintOrderRepository extends JpaRepository<PrintOrder, UUID> {
    Optional<PrintOrder> findByPublicToken(UUID publicToken);
    Optional<PrintOrder> findByOrderNumber(String orderNumber);
    Optional<PrintOrder> findByRazorpayOrderId(String razorpayOrderId);
    boolean existsByOrderNumber(String orderNumber);
    
    List<PrintOrder> findByShopIdOrderByCreatedAtDesc(UUID shopId);
    List<PrintOrder> findByShopIdAndPrintStatusOrderByCreatedAtDesc(UUID shopId, PrintStatus printStatus);
    @Query("SELECT CASE WHEN COUNT(p) > 0 THEN true ELSE false END FROM PrintOrder p LEFT JOIN p.items i WHERE p.shop.id = :shopId AND (p.document.id = :documentId OR i.document.id = :documentId)")
    boolean existsByShopIdAndDocumentId(@Param("shopId") UUID shopId, @Param("documentId") UUID documentId);

    @Query("SELECT p FROM PrintOrder p WHERE p.shop.id = :shopId AND p.printStatus IN :statuses ORDER BY p.createdAt DESC")
    List<PrintOrder> findByShopIdAndPrintStatusIn(@Param("shopId") UUID shopId, @Param("statuses") List<PrintStatus> statuses);

    @Query("SELECT COUNT(p) FROM PrintOrder p WHERE p.shop.id = :shopId AND p.printStatus = :status")
    long countByShopIdAndPrintStatus(@Param("shopId") UUID shopId, @Param("status") PrintStatus status);

    @Query("SELECT DISTINCT p FROM PrintOrder p LEFT JOIN p.items i WHERE p.shop.id = :shopId AND (p.document.id = :documentId OR i.document.id = :documentId)")
    List<PrintOrder> findOrdersByShopIdAndDocumentId(@Param("shopId") UUID shopId, @Param("documentId") UUID documentId);

    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE PrintOrder p SET p.document = null WHERE p.document.id = :documentId")
    void nullifyDocumentReference(@Param("documentId") UUID documentId);

    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE PrintOrder p SET p.document = null WHERE p.document.id IN :documentIds")
    void nullifyDocumentReferencesBulk(@Param("documentIds") List<UUID> documentIds);
}
