import { createShop } from "@printdrop/domain";
import { prismaShopAdminStore } from "../../../../../lib/shopAdminStore.js";
import { requestAdminPrincipal } from "../../../../../lib/requestAuth.js";
import {
  readJsonBody,
  isMalformed,
  ok,
  badRequest,
  fail,
} from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// POST /api/admin/shop/create — mirrors AdminShopController.createShop:
// 200 "Shop created successfully" with the API key disclosed ONCE.
export async function POST(req: Request) {
  try {
    const principal = await requestAdminPrincipal(req);
    const body = await readJsonBody(req);
    if (isMalformed(body)) {
      return badRequest("Malformed request body");
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const data = await createShop(prismaShopAdminStore, principal.id, {
      name: b["name"],
      ownerName: b["ownerName"],
      phone: b["phone"],
      address: b["address"],
      city: b["city"],
      state: b["state"],
      pincode: b["pincode"],
      logoUrl: b["logoUrl"],
    });
    return ok(data, "Shop created successfully");
  } catch (err) {
    return fail(err);
  }
}
