import { forgotPassword } from "@printdrop/domain";
import {
  getAuthContext,
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/auth/forgot-password — mirrors AuthController.forgotPassword:
// 400 missing email | 200 generic success (unknown emails too) |
// 503 mail unavailable for existing accounts.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const { email } = (body ?? {}) as { email?: string };
    await forgotPassword(getAuthContext(), email as string);
    return ok(
      null,
      "If an account exists with this email, a reset link has been sent."
    );
  } catch (err) {
    return fail(err);
  }
}

