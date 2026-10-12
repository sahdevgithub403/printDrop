import { signup } from "@printdrop/domain";
import {
  getAuthContext,
  deviceFrom,
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/auth/signup — mirrors AuthController.signup:
// 200 "Signup successful" (auto-login) | 400 validation/service | 429 throttle.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const b = (body ?? {}) as Record<string, string>;
    const data = await signup(
      getAuthContext(),
      {
        name: b["name"] as string,
        email: b["email"] as string,
        phone: b["phone"] as string,
        password: b["password"] as string,
        confirmPassword: b["confirmPassword"] as string,
      },
      deviceFrom(req)
    );
    return ok(data, "Signup successful");
  } catch (err) {
    return fail(err);
  }
}

