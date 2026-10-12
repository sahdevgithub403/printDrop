import { agentJobTransition } from "../../../../../../lib/jobActions.js";
import { fail } from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/print-agent/jobs/:jobId/completed — 200 "Print job completed".
export async function POST(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    return await agentJobTransition(req, params.jobId, "COMPLETED", "Print job completed");
  } catch (err) {
    return fail(err);
  }
}
