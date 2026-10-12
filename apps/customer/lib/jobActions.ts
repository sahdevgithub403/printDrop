import { NextResponse } from "next/server";
import {
  updateJobStatus,
  PrintJobError,
  retryJob,
} from "@printdrop/domain";
import { prismaPrintJobStore } from "./jobStore.js";
import {
  requestAgentPrincipal,
  toTenantPrincipal,
} from "./requestAuth.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
} from "./authRoutes.js";

// Shared print-agent job-action flow. Mirrors PrintAgentController:
// shop-scoped lookup (403 outside the shop), agentId from the optional
// body defaulting to "Agent-<shopId>", legacy success messages.
export async function agentShopId(req: Request): Promise<string> {
  const principal = await requestAgentPrincipal(req);
  const shopId = toTenantPrincipal(principal).shopId;
  if (shopId == null) {
    throw new PrintJobError("Shop ID is required", 403);
  }
  return shopId;
}

export async function agentJobTransition(
  req: Request,
  jobId: string,
  status: "PROCESSING" | "COMPLETED" | "FAILED",
  successMessage: string
): Promise<NextResponse> {
  const principal = await requestAgentPrincipal(req);
  const shopId = toTenantPrincipal(principal).shopId;
  if (shopId == null) {
    throw new PrintJobError("Shop ID is required", 403);
  }
  const job = await prismaPrintJobStore.findJobByIdAndShop(jobId, shopId);
  if (job == null) {
    throw new PrintJobError(
      "Unauthorized: Print job not found for authenticated shop",
      403
    );
  }
  const body = await readJsonBody(req);
  if (isMalformed(body)) {
    return badRequest("Malformed request body");
  }
  const agentId =
    body != null && typeof body === "object"
      ? ((body as Record<string, unknown>)["agentId"] as string | undefined)
      : undefined;
  const data = await updateJobStatus(
    { store: prismaPrintJobStore },
    job.id,
    status,
    typeof agentId === "string" && agentId.length > 0
      ? agentId
      : `Agent-${shopId}`
  );
  return ok(data, successMessage);
}

export async function agentJobRetry(
  req: Request,
  jobId: string
): Promise<NextResponse> {
  const principal = await requestAgentPrincipal(req);
  const shopId = toTenantPrincipal(principal).shopId;
  if (shopId == null) {
    throw new PrintJobError("Shop ID is required", 403);
  }
  const job = await prismaPrintJobStore.findJobByIdAndShop(jobId, shopId);
  if (job == null) {
    throw new PrintJobError(
      "Unauthorized: Print job not found for authenticated shop",
      403
    );
  }
  const data = await retryJob({ store: prismaPrintJobStore }, job.id);
  return ok(data, "Print job requeued");
}
