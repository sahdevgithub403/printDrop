import { prisma } from "@printdrop/db";
import type { PrintJobStore, PrintJobRow } from "@printdrop/domain";
import { readOrderGraphTx, type PrismaTx } from "./orderStore.js";

// Prisma-backed print-job store. Atomic claims use a conditional
// updateMany row-count (the claimJob JPQL equivalent); status
// applications mirror PrintService's in-memory-then-save flow.

async function readJob(
  db: typeof prisma | PrismaTx,
  jobId: string
): Promise<PrintJobRow | null> {
  const client = db as typeof prisma;
  const job = await client.printJob.findUnique({
    where: { id: jobId },
  });
  if (job == null) {
    return null;
  }
  const full = await readOrderGraphTx(client, { id: job.orderId });
  if (full == null) {
    return null;
  }
  return {
    id: job.id,
    status: job.status,
    assignedAgentId: job.assignedAgentId,
    createdAt: job.createdAt,
    order: full,
  };
}

export const prismaPrintJobStore: PrintJobStore = {
  async findQueuedJobsByShop(shopId: string) {
    const jobs = await prisma.printJob.findMany({
      where: { status: "QUEUED", order: { shopId } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const rows: PrintJobRow[] = [];
    for (const j of jobs) {
      const full = await readJob(prisma, j.id);
      if (full != null) {
        rows.push(full);
      }
    }
    return rows;
  },

  async findJobByIdAndShop(jobId: string, shopId: string) {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, order: { shopId } },
      select: { id: true },
    });
    if (job == null) {
      return null;
    }
    return readJob(prisma, job.id);
  },

  async findJobById(jobId: string) {
    return readJob(prisma, jobId);
  },

  async claimJob(jobId, from, to, agentId) {
    const result = await prisma.printJob.updateMany({
      where: { id: jobId, status: from },
      data: { status: to, assignedAgentId: agentId },
    });
    return result.count;
  },

  async applyJobStatus(input) {
    return prisma.$transaction(async (tx) => {
      const data: { status: string; assignedAgentId?: string | null } = {
        status: input.status,
      };
      if (input.resetAssignment) {
        data.assignedAgentId = null;
      } else if (input.assignedAgentId != null) {
        data.assignedAgentId = input.assignedAgentId;
      }
      await tx.printJob.update({ where: { id: input.jobId }, data });
      const job = await tx.printJob.findUnique({
        where: { id: input.jobId },
      });
      await tx.printOrder.update({
        where: { id: job!.orderId },
        data: { printStatus: input.orderPrintStatus },
      });
      if (input.itemPrintStatus != null) {
        if (input.itemMode === "pending-only") {
          await tx.orderItem.updateMany({
            where: { orderId: job!.orderId, printStatus: "PENDING" },
            data: { printStatus: input.itemPrintStatus },
          });
        } else {
          await tx.orderItem.updateMany({
            where: { orderId: job!.orderId },
            data: { printStatus: input.itemPrintStatus },
          });
        }
      }
      const full = await readJob(tx as unknown as typeof prisma, input.jobId);
      if (full == null) {
        throw new Error("job vanished during status update");
      }
      return full;
    });
  },
};
