import { agentJobRetry } from "../../../../../../lib/jobActions.js";
import { fail } from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/print-agent/jobs/:jobId/retry — mirrors retryJob: FAILED-only,
// 200 "Print job requeued".
export async function POST(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    return await agentJobRetry(req, params.jobId);
  } catch (err) {
    return fail(err);
  }
}
