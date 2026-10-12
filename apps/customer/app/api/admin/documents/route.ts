import { getShopDocuments, AuthorizationError } from "@printdrop/domain";
import { prismaAdminDocumentStore } from "../../../../lib/adminDocStore.js";
import { requestAdminPrincipal } from "../../../../lib/requestAuth.js";
import { ok, fail } from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/admin/documents?search&type&sort&page&size — mirrors
// AdminDocumentController.getShopDocuments: shop-less non-super -> 403;
// super without shop -> 400; size clamped 1..100 server-side.
export async function GET(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      if (principal.role !== "ROLE_SUPER_ADMIN") {
        throw new AuthorizationError(
          "User not authenticated or shop context missing",
          403
        );
      }
      throw new AuthorizationError(
        "Super admin must provide shop context to list documents",
        400
      );
    }
    const { searchParams } = new URL(req.url);
    const parseCount = (raw: string | null, fallback: number): number => {
      if (raw == null) {
        return fallback;
      }
      const n = Number.parseInt(raw, 10);
      if (!Number.isInteger(n)) {
        throw new AuthorizationError("Invalid pagination parameters", 400);
      }
      return n;
    };
    const page = parseCount(searchParams.get("page"), 0);
    const size = Math.min(Math.max(1, parseCount(searchParams.get("size"), 25)), 100);
    const data = await getShopDocuments(
      prismaAdminDocumentStore,
      principal.shopId,
      searchParams.get("search"),
      searchParams.get("type") ?? "ALL",
      searchParams.get("sort") ?? "NEWEST",
      page,
      size
    );
    return ok(data, "Success");
  } catch (err) {
    return fail(err);
  }
}
