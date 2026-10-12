import { toShopDTO, updateShop, ShopAdminError } from "@printdrop/domain";
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

function nullKey<T extends { apiKey: unknown }>(dto: T): T {
  return { ...dto, apiKey: null };
}

// GET /api/admin/shop — 404 without setup (never 500), apiKey nulled.
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
    return ok(nullKey(toShopDTO(shop)), "Success");
  } catch (err) {
    return fail(err);
  }
}

// PUT /api/admin/shop — mirrors AdminShopController.updateShopProfile:
// 404 without setup; apiKey never disclosed.
export async function PUT(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    if (principal.shopId == null) {
      throw new ShopAdminError(
        "No shop associated with this account yet. Please complete shop setup.",
        404
      );
    }
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const data = await updateShop(
      prismaShopAdminStore,
      principal.shopId,
      (body ?? {}) as Record<string, unknown>
    );
    return ok(data, "Shop profile updated successfully");
  } catch (err) {
    return fail(err);
  }
}
