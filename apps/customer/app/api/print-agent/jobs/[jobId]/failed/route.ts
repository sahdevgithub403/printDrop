import { agentJobTransition } from "../../../../../../lib/jobActions.js";
import { fail } from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/print-agent/jobs/:jobId/failed — 200 "Print job marked failed".
export async function POST(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    return await agentJobTransition(req, params.jobId, "FAILED", "Print job marked failed");
  } catch (err) {
    return fail(err);
  }
}
