import { assertServerRuntime } from "./serverOnly.js";

// Public shop lookup.
// Source: backend/.../controller/PublicShopController.java +
// ShopService.getShopBySlug/mapShopToDTO — exact slug match, absent slug ->
// 400 "Shop not found with slug: <slug>" (IllegalArgument, NOT 404);
// apiKey ALWAYS nulled on public reads (C-04); isOpen null -> true
// (mapShopToDTO + ShopDTO.getIsOpen). Closed shops are still returned;
// the closed-shop order rejection lives in order creation (later phase).

export interface ShopRow {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isOpen: boolean | null;
}

export interface ShopDTOBody {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  apiKey: null;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isOpen: boolean;
}

export interface ShopStore {
  findShopBySlug(slug: string): Promise<ShopRow | null>;
}

export class ShopLookupError extends Error {
  constructor(
    message: string,
    readonly status: 400 = 400
  ) {
    super(message);
  }
}

export async function getShopBySlug(
  store: ShopStore,
  slug: string
): Promise<ShopDTOBody> {
  assertServerRuntime("getShopBySlug");
  const shop = await store.findShopBySlug(slug);
  if (shop == null) {
    throw new ShopLookupError(`Shop not found with slug: ${slug}`);
  }
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    address: shop.address,
    phone: shop.phone,
    logoUrl: shop.logoUrl,
    apiKey: null,
    ownerName: shop.ownerName,
    city: shop.city,
    state: shop.state,
    pincode: shop.pincode,
    isOpen: shop.isOpen ?? true,
  };
}
