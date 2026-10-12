import { prisma } from "@printdrop/db";
import {
  authenticateRequest,
  verifyJwt,
  AuthorizationError,
} from "@printdrop/domain";
import { prismaPrincipalStores } from "../../../../lib/principalStore.js";
import { loadServerEnv } from "@printdrop/domain";
import { ok, fail } from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/print-agent/heartbeat — mirrors PrintAgentController.heartbeat:
// resolves the shop (M-01 super-admin param rule), reports REAL session
// validity (JWT session row ACTIVE+unexpired with lastHeartbeat touch;
// API-key agents valid by key), {status:"ok", serverTime, sessionValid}.
export async function POST(req: Request) {
  try {
    const { jwtSecret } = loadServerEnv();
    const principal = await authenticateRequest(
      prismaPrincipalStores,
      req.headers,
      jwtSecret
    );
    if (principal == null) {
      throw new AuthorizationError(
        "Unauthorized access: Full authentication is required to access this resource",
        401
      );
    }

    let authShopId: string | null = null;
    let sessionValid = false;
    if (principal.kind === "agent") {
      // API-key agents carry no user session — the authenticated key
      // itself is the validity signal.
      authShopId = principal.shopId;
      sessionValid = authShopId != null;
    } else {
      authShopId = principal.shopId;
      const bearer = (req.headers.get("Authorization") ?? "").replace(
        /^Bearer\s+/,
        ""
      );
      if (bearer.length > 0) {
        try {
          const claims = await verifyJwt(jwtSecret, bearer);
          if (claims.sessionId != null) {
            const session = await prisma.userSession.findUnique({
              where: { sessionToken: claims.sessionId },
            });
            if (
              session != null &&
              session.status === "ACTIVE" &&
              session.expiresAt != null &&
              session.expiresAt.getTime() > Date.now()
            ) {
              sessionValid = true;
              await prisma.userSession.update({
                where: { id: session.id },
                data: { lastHeartbeat: new Date() },
              });
            }
          }
        } catch {
          sessionValid = false;
        }
      }
    }

    return ok(
      {
        status: "ok",
        serverTime: new Date().toISOString(),
        sessionValid,
      },
      "Success"
    );
  } catch (err) {
    return fail(err);
  }
}
