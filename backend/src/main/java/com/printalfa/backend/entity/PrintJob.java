package com.printalfa.backend.entity;

import com.printalfa.backend.enums.JobStatus;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "print_jobs")
public class PrintJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private PrintOrder order;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private JobStatus status;

    // Optimistic locking to prevent double-print claims from concurrent agents.
    @Version
    private Long version;

    private String assignedAgentId;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public PrintJob() {}

    public PrintJob(PrintOrder order, JobStatus status) {
        this.order = order;
        this.status = status;
    }

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public PrintOrder getOrder() { return order; }
    public void setOrder(PrintOrder order) { this.order = order; }

    public JobStatus getStatus() { return status; }
    public void setStatus(JobStatus status) { this.status = status; }

    public String getAssignedAgentId() { return assignedAgentId; }
    public void setAssignedAgentId(String assignedAgentId) { this.assignedAgentId = assignedAgentId; }

    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
