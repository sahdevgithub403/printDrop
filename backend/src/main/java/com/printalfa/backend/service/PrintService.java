package com.printalfa.backend.service;

import com.printalfa.backend.dto.PrintJobDTO;
import com.printalfa.backend.entity.OrderItem;
import com.printalfa.backend.entity.PrintJob;
import com.printalfa.backend.enums.JobStatus;
import com.printalfa.backend.enums.PrintStatus;
import com.printalfa.backend.repository.PrintJobRepository;
import com.printalfa.backend.repository.PrintOrderRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class PrintService {

    private final PrintJobRepository printJobRepository;
    private final PrintOrderRepository printOrderRepository;
    private final OrderService orderService;
    private final WebSocketService webSocketService;

    public PrintService(PrintJobRepository printJobRepository,
                        PrintOrderRepository printOrderRepository,
                        OrderService orderService,
                        WebSocketService webSocketService) {
        this.printJobRepository = printJobRepository;
        this.printOrderRepository = printOrderRepository;
        this.orderService = orderService;
        this.webSocketService = webSocketService;
    }

    @Transactional(readOnly = true)
    public List<PrintJobDTO> getQueuedJobsByShop(UUID shopId) {
        if (shopId == null) {
            throw new org.springframework.security.access.AccessDeniedException("Shop ID is required to fetch tenant print queue");
        }
        return printJobRepository.findByOrderShopIdAndStatusOrderByCreatedAtAsc(shopId, JobStatus.QUEUED)
                .stream()
                .map(this::mapToDTO)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public PrintJobDTO getJobByIdAndShop(UUID jobId, UUID shopId) {
        if (shopId == null) {
            throw new org.springframework.security.access.AccessDeniedException("Shop ID is required");
        }
        PrintJob job = printJobRepository.findByIdAndOrderShopId(jobId, shopId)
                .orElseThrow(() -> new org.springframework.security.access.AccessDeniedException("Print job not found for authenticated shop"));
        return mapToDTO(job);
    }

    // Allowed job-status transitions. COMPLETED is terminal; FAILED retries only via QUEUED.
    private static final Map<JobStatus, java.util.Set<JobStatus>> JOB_STATUS_TRANSITIONS = Map.of(
            JobStatus.QUEUED, java.util.Set.of(JobStatus.PROCESSING, JobStatus.COMPLETED, JobStatus.FAILED),
            JobStatus.PROCESSING, java.util.Set.of(JobStatus.COMPLETED, JobStatus.FAILED),
            JobStatus.FAILED, java.util.Set.of(JobStatus.QUEUED),
            JobStatus.COMPLETED, java.util.Set.of()
    );

    private static void requireAllowedJobTransition(JobStatus from, JobStatus to) {
        if (from == null || to == null) {
            throw new IllegalArgumentException("Job status must be specified");
        }
        if (from == to && from != JobStatus.PROCESSING) {
            return; // idempotent no-op (PROCESSING re-claims still enforce agent binding below)
        }
        java.util.Set<JobStatus> allowed = JOB_STATUS_TRANSITIONS.getOrDefault(from, java.util.Set.of());
        if (!allowed.contains(to)) {
            throw new IllegalStateException("Invalid job status transition from " + from + " to " + to);
        }
    }

    @Transactional
    public PrintJobDTO updateJobStatus(UUID jobId, JobStatus status, String agentId) {
        if (status == null) {
            throw new IllegalArgumentException("Job status must be specified");
        }
        PrintJob job = printJobRepository.findById(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Print job not found"));

        requireAllowedJobTransition(job.getStatus(), status);

        // Payment gate: ONLINE orders require PAID before printing/completing.
        if (job.getOrder() != null
                && job.getOrder().getPaymentMethod() == com.printalfa.backend.enums.PaymentMethod.ONLINE
                && job.getOrder().getPaymentStatus() != com.printalfa.backend.enums.PaymentStatus.PAID
                && (status == JobStatus.PROCESSING || status == JobStatus.COMPLETED)) {
            throw new IllegalStateException("Online payment must be PAID before printing or completing");
        }

        // Atomic claim: PROCESSING claims from QUEUED/FAILED only win if the job is still in
        // the expected state, preventing two agents from double-printing the same job.
        // Re-claims of an already-PROCESSING job enforce agent binding (no silent takeover).
        if (status == JobStatus.PROCESSING && job.getStatus() == JobStatus.PROCESSING) {
            if (job.getAssignedAgentId() != null && agentId != null
                    && !job.getAssignedAgentId().equals(agentId)) {
                throw new IllegalStateException("Print job is already being processed by agent: " + job.getAssignedAgentId());
            }
            if (job.getAssignedAgentId() != null && agentId == null) {
                throw new IllegalStateException("Print job is already being processed by agent: " + job.getAssignedAgentId());
            }
            if (agentId != null) {
                job.setAssignedAgentId(agentId);
            }
        } else if (status == JobStatus.PROCESSING) {
            JobStatus expected = job.getStatus();
            if (expected == JobStatus.QUEUED || expected == JobStatus.FAILED) {
                int claimed = printJobRepository.claimJob(jobId, expected, JobStatus.PROCESSING,
                        agentId != null ? agentId : "Agent-Local");
                if (claimed == 0) {
                    throw new IllegalStateException("Print job was already claimed by another agent");
                }
                job = printJobRepository.findById(jobId)
                        .orElseThrow(() -> new IllegalArgumentException("Print job not found"));
            } else if (job.getStatus() == JobStatus.PROCESSING && job.getAssignedAgentId() != null
                    && !job.getAssignedAgentId().equals(agentId)) {
                throw new IllegalStateException("Print job is already being processed by agent: " + job.getAssignedAgentId());
            }
            job.setAssignedAgentId(agentId != null ? agentId : "Agent-Local");
            job.setStatus(JobStatus.PROCESSING);
            job.getOrder().setPrintStatus(PrintStatus.PRINTING);
            if (job.getOrder().getItems() != null) {
                for (OrderItem item : job.getOrder().getItems()) {
                    if (item.getPrintStatus() == PrintStatus.PENDING) {
                        item.setPrintStatus(PrintStatus.PRINTING);
                    }
                }
            }
        } else if (status == JobStatus.COMPLETED) {
            job.setStatus(JobStatus.COMPLETED);
            if (agentId != null) {
                job.setAssignedAgentId(agentId);
            }
            job.getOrder().setPrintStatus(PrintStatus.COMPLETED);
            if (job.getOrder().getItems() != null) {
                for (OrderItem item : job.getOrder().getItems()) {
                    item.setPrintStatus(PrintStatus.COMPLETED);
                }
            }
        } else if (status == JobStatus.FAILED) {
            job.setStatus(JobStatus.FAILED);
            if (agentId != null) {
                job.setAssignedAgentId(agentId);
            }
            job.getOrder().setPrintStatus(PrintStatus.FAILED);
            if (job.getOrder().getItems() != null) {
                for (OrderItem item : job.getOrder().getItems()) {
                    item.setPrintStatus(PrintStatus.FAILED);
                }
            }
        } else if (status == JobStatus.QUEUED) {
            job.setStatus(JobStatus.QUEUED);
            job.setAssignedAgentId(null);
            job.getOrder().setPrintStatus(PrintStatus.PENDING);
            if (job.getOrder().getItems() != null) {
                for (OrderItem item : job.getOrder().getItems()) {
                    item.setPrintStatus(PrintStatus.PENDING);
                }
            }
        }

        printOrderRepository.save(job.getOrder());
        PrintJob saved = printJobRepository.save(job);

        // Notify Admin Dashboard
        Map<String, Object> event = new HashMap<>();
        event.put("type", "ORDER_STATUS_UPDATED");
        event.put("order", orderService.mapToDTO(saved.getOrder()));
        webSocketService.sendOrderUpdate(saved.getOrder().getShop().getId(), event);

        return mapToDTO(saved);
    }

    @Transactional
    public PrintJobDTO updateJobStatusWithShopCheck(UUID jobId, JobStatus status, String agentId, UUID authShopId) {
        if (authShopId == null) {
            throw new org.springframework.security.access.AccessDeniedException("Shop ID is required");
        }
        PrintJob job = printJobRepository.findByIdAndOrderShopId(jobId, authShopId)
                .orElseThrow(() -> new org.springframework.security.access.AccessDeniedException("Unauthorized: Print job not found for authenticated shop"));

        return updateJobStatus(job.getId(), status, agentId);
    }

    @Transactional
    public PrintJobDTO retryJobWithShopCheck(UUID jobId, UUID authShopId) {
        if (authShopId == null) {
            throw new org.springframework.security.access.AccessDeniedException("Shop ID is required");
        }
        PrintJob job = printJobRepository.findByIdAndOrderShopId(jobId, authShopId)
                .orElseThrow(() -> new org.springframework.security.access.AccessDeniedException("Unauthorized: Print job not found for authenticated shop"));

        return retryJob(job.getId());
    }

    @Transactional
    public PrintJobDTO retryJob(UUID jobId) {
        PrintJob job = printJobRepository.findById(jobId)
                .orElseThrow(() -> new IllegalArgumentException("Print job not found"));
        // Retry is allowed only from FAILED (requeue); terminal COMPLETED stays terminal.
        if (job.getStatus() != JobStatus.FAILED) {
            throw new IllegalStateException("Only FAILED jobs can be retried");
        }
        return updateJobStatus(jobId, JobStatus.QUEUED, null);
    }

    public PrintJobDTO mapToDTO(PrintJob job) {
        PrintJobDTO dto = new PrintJobDTO();
        dto.setJobId(job.getId());
        dto.setOrder(orderService.mapToDTO(job.getOrder()));
        dto.setStatus(job.getStatus());
        dto.setAssignedAgentId(job.getAssignedAgentId());
        dto.setCreatedAt(job.getCreatedAt());
        return dto;
    }
}
