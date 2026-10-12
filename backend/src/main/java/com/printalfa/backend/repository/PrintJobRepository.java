package com.printalfa.backend.repository;

import com.printalfa.backend.entity.PrintJob;
import com.printalfa.backend.enums.JobStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PrintJobRepository extends JpaRepository<PrintJob, UUID> {
    Optional<PrintJob> findByIdAndOrderShopId(UUID id, UUID shopId);
    Optional<PrintJob> findByOrderId(UUID orderId);
    boolean existsByOrderId(UUID orderId);
    Optional<PrintJob> findByOrderIdAndOrderShopId(UUID orderId, UUID shopId);
    List<PrintJob> findByStatusOrderByCreatedAtAsc(JobStatus status);
    List<PrintJob> findByOrderShopIdAndStatusOrderByCreatedAtAsc(UUID shopId, JobStatus status);
    // Atomic claim support: only claim jobs still in the expected state (prevents double-print).
    Optional<PrintJob> findByIdAndStatus(UUID id, JobStatus status);
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @org.springframework.data.jpa.repository.Query("UPDATE PrintJob j SET j.status = :to, j.assignedAgentId = :agentId WHERE j.id = :id AND j.status = :from")
    int claimJob(@org.springframework.data.repository.query.Param("id") UUID id,
                 @org.springframework.data.repository.query.Param("from") JobStatus from,
                 @org.springframework.data.repository.query.Param("to") JobStatus to,
                 @org.springframework.data.repository.query.Param("agentId") String agentId);
}
