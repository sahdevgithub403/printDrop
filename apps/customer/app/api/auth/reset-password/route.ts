import { resetPassword } from "@printdrop/domain";
import {
  getAuthContext,
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/auth/reset-password — mirrors AuthController.resetPassword:
// 400 guard/service messages | 200 reset confirmation.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const { token, newPassword } = (body ?? {}) as {
      token?: string;
      newPassword?: string;
    };
    await resetPassword(getAuthContext(), token, newPassword);
    return ok(null, "Password has been reset successfully. Please login again.");
  } catch (err) {
    return fail(err);
  }
}

