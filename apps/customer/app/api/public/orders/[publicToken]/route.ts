import { getOrderByPublicToken } from "@printdrop/domain";
import { prismaOrderStore } from "../../../../../lib/orderStore.js";
import { ok, fail } from "../../../../../lib/authRoutes.js";

export const runtime = "nodejs";

// GET /api/public/orders/:publicToken — mirrors
// PublicOrderController.getOrderByPublicToken: 200 order | 400 unknown.
export async function GET(
  _req: Request,
  { params }: { params: { publicToken: string } }
) {
  try {
    const data = await getOrderByPublicToken(
      prismaOrderStore,
      decodeURIComponent(params.publicToken)
    );
    return ok(data, "Success");
  } catch (err) {
    return fail(err);
  }
}
