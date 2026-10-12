import { toJobDTO, PrintJobError } from "@printdrop/domain";
import { prismaPrintJobStore } from "../../../../lib/jobStore.js";
import {
  requestAgentPrincipal,
  toTenantPrincipal,
} from "../../../../lib/requestAuth.js";
import { resolveAgentShopId } from "@printdrop/domain";
import { ok, fail } from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/print-agent/jobs?shopId= — mirrors
// PrintAgentController.getQueuedJobs: QUEUED queue scoped to the resolved
// shop; M-01 super-admin scoping; 403 without context.
export async function GET(req: Request) {
  try {
    const principal = await requestAgentPrincipal(req);
    const { searchParams } = new URL(req.url);
    const requested = searchParams.get("shopId");
    if (requested != null && requested.trim().length > 0) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          requested.trim()
        )
      ) {
        throw new PrintJobError("Invalid shop ID", 400);
      }
    }
    const shopId = resolveAgentShopId(
      toTenantPrincipal(principal),
      requested != null && requested.trim().length > 0 ? requested.trim() : null
    );
    if (shopId == null) {
      throw new PrintJobError(
        "Shop context is required to fetch the print queue",
        403
      );
    }
    const jobs = await prismaPrintJobStore.findQueuedJobsByShop(shopId);
    return ok(jobs.map(toJobDTO), "Success");
  } catch (err) {
    return fail(err);
  }
}
