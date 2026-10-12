import { agentJobTransition } from "../../../../../../lib/jobActions.js";
import { fail } from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/print-agent/jobs/:jobId/started — 200 "Print job started".
export async function POST(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    return await agentJobTransition(req, params.jobId, "PROCESSING", "Print job started");
  } catch (err) {
    return fail(err);
  }
}
