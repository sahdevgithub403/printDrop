import { toJobDTO, PrintJobError } from "@printdrop/domain";
import { prismaPrintJobStore } from "../../../../../lib/jobStore.js";
import { agentShopId } from "../../../../../lib/jobActions.js";
import { ok, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/print-agent/jobs/:jobId — mirrors getJobById: 403 when the job
// is not in the authenticated shop.
export async function GET(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    const shopId = await agentShopId(req);
    const job = await prismaPrintJobStore.findJobByIdAndShop(
      params.jobId,
      shopId
    );
    if (job == null) {
      throw new PrintJobError(
        "Print job not found for authenticated shop",
        403
      );
    }
    return ok(toJobDTO(job), "Success");
  } catch (err) {
    return fail(err);
  }
}
