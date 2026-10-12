import { login } from "@printdrop/domain";
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

// POST /api/auth/login — mirrors AuthController.login:
// 200 "Login successful" | 400 validation | 401 bad credentials | 429 throttle.
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const { email, password } = (body ?? {}) as {
      email?: string;
      password?: string;
    };
    const data = await login(
      getAuthContext(),
      { email: email as string, password: password as string },
      deviceFrom(req)
    );
    return ok(data, "Login successful");
  } catch (err) {
    return fail(err);
  }
}

