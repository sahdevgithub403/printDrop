import {
  toPricingDTO,
  updateShopPricing,
  ShopAdminError,
} from "@printdrop/domain";
import { prismaShopAdminStore } from "../../../../lib/shopAdminStore.js";
import { requestAdminPrincipal } from "../../../../lib/requestAuth.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/admin/pricing — mirrors AdminPricingController.getPricing:
// 400 when unconfigured (no 404 conversion here, exactly like legacy).
export async function GET(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    const pricing = await prismaShopAdminStore.findPricingByShopId(
      principal.shopId ?? ""
    );
    if (pricing == null) {
      throw new ShopAdminError("Pricing not found for shop", 400);
    }
    return ok(toPricingDTO(pricing), "Success");
  } catch (err) {
    return fail(err);
  }
}

// PUT /api/admin/pricing — mirrors updatePricing: 200
// "Pricing updated successfully"; negatives rejected.
export async function PUT(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const data = await updateShopPricing(
      prismaShopAdminStore,
      principal.shopId ?? "",
      (body ?? {}) as Record<string, unknown>
    );
    return ok(data, "Pricing updated successfully");
  } catch (err) {
    return fail(err);
  }
}
