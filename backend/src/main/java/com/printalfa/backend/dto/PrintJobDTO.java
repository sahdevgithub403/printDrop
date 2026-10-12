package com.printalfa.backend.dto;

import com.printalfa.backend.enums.JobStatus;
import java.time.LocalDateTime;
import java.util.UUID;

public class PrintJobDTO {
    private UUID jobId;
    private OrderDTO order;
    private JobStatus status;
    private String assignedAgentId;
    private LocalDateTime createdAt;

    public PrintJobDTO() {}

    public UUID getJobId() { return jobId; }
    public void setJobId(UUID jobId) { this.jobId = jobId; }

    public OrderDTO getOrder() { return order; }
    public void setOrder(OrderDTO order) { this.order = order; }

    public JobStatus getStatus() { return status; }
    public void setStatus(JobStatus status) { this.status = status; }

    public String getAssignedAgentId() { return assignedAgentId; }
    public void setAssignedAgentId(String assignedAgentId) { this.assignedAgentId = assignedAgentId; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
