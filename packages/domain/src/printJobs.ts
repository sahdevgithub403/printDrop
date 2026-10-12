import { assertServerRuntime } from "./serverOnly.js";
import { publishEvent, readRealtimeConfig } from "./events.js";
import { mapOrderToDTO, type OrderRow } from "./orders.js";

// Print-job lifecycle. Source: backend/.../service/PrintService.java —
// full transcription: QUEUED-only listing, tenant-scoped lookup,
// transition map (PROCESSING re-claim agent binding), ONLINE PAID gate,
// atomic claimJob row-count semantics, order/item status propagation,
// ORDER_STATUS_UPDATED emit, FAILED-only retry.

export const JOB_STATUS_TRANSITIONS: Record<string, string[]> = {
  QUEUED: ["PROCESSING", "COMPLETED", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  FAILED: ["QUEUED"],
  COMPLETED: [],
};

const JOB_STATUSES = new Set(Object.keys(JOB_STATUS_TRANSITIONS));

export class PrintJobError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 = 400
  ) {
    super(message);
  }
}

export interface PrintJobRow {
  id: string;
  status: string;
  assignedAgentId: string | null;
  createdAt: Date;
  order: OrderRow;
}

export interface PrintJobStore {
  findQueuedJobsByShop(shopId: string): Promise<PrintJobRow[]>;
  findJobByIdAndShop(jobId: string, shopId: string): Promise<PrintJobRow | null>;
  findJobById(jobId: string): Promise<PrintJobRow | null>;
  claimJob(
    jobId: string,
    from: string,
    to: string,
    agentId: string
  ): Promise<number>;
  applyJobStatus(input: {
    jobId: string;
    status: string;
    assignedAgentId: string | null;
    orderPrintStatus: string;
    itemPrintStatus: string | null;
    /** PROCESSING flips only PENDING items; other targets set all items. */
    itemMode: "pending-only" | "all";
    resetAssignment: boolean;
  }): Promise<PrintJobRow>;
}

export function toJobDTO(job: PrintJobRow): {
  jobId: string;
  order: ReturnType<typeof mapOrderToDTO>;
  status: string;
  assignedAgentId: string | null;
  createdAt: string;
} {
  return {
    jobId: job.id,
    order: mapOrderToDTO(job.order),
    status: job.status,
    assignedAgentId: job.assignedAgentId,
    createdAt: job.createdAt.toISOString(),
  };
}

function requireAllowedJobTransition(from: string | null, to: string | null): void {
  if (from == null || to == null) {
    throw new PrintJobError("Job status must be specified", 400);
  }
  if (from === to && from !== "PROCESSING") {
    return;
  }
  if (!(JOB_STATUS_TRANSITIONS[from] ?? []).includes(to)) {
    throw new PrintJobError(
      `Invalid job status transition from ${from} to ${to}`,
      400
    );
  }
}

export async function updateJobStatus(
  ctx: { store: PrintJobStore },
  jobId: string,
  status: unknown,
  agentId: string | null
): Promise<ReturnType<typeof toJobDTO>> {
  assertServerRuntime("updateJobStatus");
  if (typeof status !== "string" || !JOB_STATUSES.has(status)) {
    if (status == null) {
      throw new PrintJobError("Job status must be specified", 400);
    }
    throw new PrintJobError("Malformed request body", 400);
  }
  const job = await ctx.store.findJobById(jobId);
  if (job == null) {
    throw new PrintJobError("Print job not found", 400);
  }
  requireAllowedJobTransition(job.status, status);

  const order = job.order;
  if (
    order.paymentMethod === "ONLINE" &&
    order.paymentStatus !== "PAID" &&
    (status === "PROCESSING" || status === "COMPLETED")
  ) {
    throw new PrintJobError(
      "Online payment must be PAID before printing or completing",
      400
    );
  }

  if (status === "PROCESSING" && job.status === "PROCESSING") {
    if (
      job.assignedAgentId != null &&
      agentId != null &&
      job.assignedAgentId !== agentId
    ) {
      throw new PrintJobError(
        `Print job is already being processed by agent: ${job.assignedAgentId}`,
        400
      );
    }
    if (job.assignedAgentId != null && agentId == null) {
      throw new PrintJobError(
        `Print job is already being processed by agent: ${job.assignedAgentId}`,
        400
      );
    }
    const updated = await ctx.store.applyJobStatus({
      jobId,
      status: "PROCESSING",
      assignedAgentId: agentId,
      orderPrintStatus: "PRINTING",
      itemPrintStatus: "PRINTING",
      itemMode: "pending-only",
      resetAssignment: false,
    });
    const dto = toJobDTO(updated);
    await publishEvent(readRealtimeConfig(), order.shopId, {
      type: "ORDER_STATUS_UPDATED",
      order: dto.order,
    });
    return dto;
  }

  if (status === "PROCESSING") {
    const expected = job.status;
    if (expected === "QUEUED" || expected === "FAILED") {
      const claimed = await ctx.store.claimJob(
        jobId,
        expected,
        "PROCESSING",
        agentId ?? "Agent-Local"
      );
      if (claimed === 0) {
        throw new PrintJobError(
          "Print job was already claimed by another agent",
          400
        );
      }
    } else if (
      job.status === "PROCESSING" &&
      job.assignedAgentId != null &&
      job.assignedAgentId !== agentId
    ) {
      throw new PrintJobError(
        `Print job is already being processed by agent: ${job.assignedAgentId}`,
        400
      );
    }
    const updated = await ctx.store.applyJobStatus({
      jobId,
      status: "PROCESSING",
      assignedAgentId: agentId ?? "Agent-Local",
      orderPrintStatus: "PRINTING",
      itemPrintStatus: "PRINTING",
      itemMode: "pending-only",
      resetAssignment: false,
    });
    const dto = toJobDTO(updated);
    await publishEvent(readRealtimeConfig(), order.shopId, {
      type: "ORDER_STATUS_UPDATED",
      order: dto.order,
    });
    return dto;
  }

  if (status === "COMPLETED" || status === "FAILED") {
    const updated = await ctx.store.applyJobStatus({
      jobId,
      status,
      assignedAgentId: agentId,
      orderPrintStatus: status,
      itemPrintStatus: status,
      itemMode: "all",
      resetAssignment: false,
    });
    const dto = toJobDTO(updated);
    await publishEvent(readRealtimeConfig(), order.shopId, {
      type: "ORDER_STATUS_UPDATED",
      order: dto.order,
    });
    return dto;
  }

  // QUEUED (retry path): assignment cleared, order/items back to PENDING.
  const updated = await ctx.store.applyJobStatus({
    jobId,
    status: "QUEUED",
    assignedAgentId: null,
    orderPrintStatus: "PENDING",
    itemPrintStatus: "PENDING",
    itemMode: "all",
    resetAssignment: true,
  });
  const dto = toJobDTO(updated);
  await publishEvent(readRealtimeConfig(), order.shopId, {
    type: "ORDER_STATUS_UPDATED",
    order: dto.order,
  });
  return dto;
}

export async function retryJob(
  ctx: { store: PrintJobStore },
  jobId: string
): Promise<ReturnType<typeof toJobDTO>> {
  assertServerRuntime("retryJob");
  const job = await ctx.store.findJobById(jobId);
  if (job == null) {
    throw new PrintJobError("Print job not found", 400);
  }
  if (job.status !== "FAILED") {
    throw new PrintJobError("Only FAILED jobs can be retried", 400);
  }
  return updateJobStatus(ctx, jobId, "QUEUED", null);
}
