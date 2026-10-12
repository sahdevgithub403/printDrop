import { regenerateApiKey, requireShopId } from "@printdrop/domain";
import { prismaShopAdminStore } from "../../../../../../lib/shopAdminStore.js";
import { requestAdminPrincipal } from "../../../../../../lib/requestAuth.js";
import { ok, fail } from "../../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/admin/shop/api-key/regenerate — mirrors
// AdminShopController.regenerateApiKey: 404 without setup; new key once.
export async function POST(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    const shopId = requireShopId({ shopId: principal.shopId });
    const data = await regenerateApiKey(prismaShopAdminStore, shopId);
    return ok(data, "API key regenerated successfully");
  } catch (err) {
    return fail(err);
  }
}
