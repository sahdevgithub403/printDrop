import { shopQrData, toShopDTO, ShopAdminError } from "@printdrop/domain";
import { prismaShopAdminStore } from "../../../../../lib/shopAdminStore.js";
import { requestAdminPrincipal } from "../../../../../lib/requestAuth.js";
import { ok, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/admin/shop/qr — mirrors AdminShopController.getShopQR:
// {shopSlug, shopName, shopUrl, fullShopUrl}; 404 without setup.
export async function GET(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      throw new ShopAdminError(
        "No shop associated with this account yet. Please complete shop setup.",
        404
      );
    }
    const shop = await prismaShopAdminStore.findShopById(principal.shopId);
    if (shop == null) {
      throw new ShopAdminError("Shop not found", 400);
    }
    const dto = toShopDTO(shop);
    const customerUrl =
      process.env["APP_CUSTOMER_URL"]?.trim() || "http://localhost:3000";
    return ok(shopQrData(dto, customerUrl), "Success");
  } catch (err) {
    return fail(err);
  }
}
