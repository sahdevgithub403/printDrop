import { getShopBySlug } from "@printdrop/domain";
import { prismaShopStore } from "../../../../../lib/publicStore.js";
import { ok, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/public/shops/:slug — mirrors PublicShopController.getShopBySlug:
// 200 shop (apiKey null) | 400 unknown slug. Closed shops are returned
// as-is; order-time rejection is out of scope for this phase.
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const data = await getShopBySlug(
      prismaShopStore,
      decodeURIComponent(params.slug)
    );
    return ok(data, "Success");
  } catch (err) {
    return fail(err);
  }
}
