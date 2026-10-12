package com.printalfa.backend.repository;

import com.printalfa.backend.entity.Document;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface DocumentRepository extends JpaRepository<Document, UUID> {
    List<Document> findByParentDocumentId(UUID parentDocumentId);
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Document d WHERE d.id = :documentId")
    void deleteDocumentByIdDirect(@Param("documentId") UUID documentId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Document d WHERE d.id IN :documentIds")
    void deleteDocumentsByIdDirect(@Param("documentIds") List<UUID> documentIds);
}
