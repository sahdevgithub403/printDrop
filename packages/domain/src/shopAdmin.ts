import { randomUUID } from "node:crypto";
import { assertServerRuntime } from "./serverOnly.js";
import { decimalToPaise, paiseToDecimal } from "./pricing.js";

// Shop administration. Sources: backend/.../service/ShopService.java
// (one-shop rule, slugify+counter, default pricing matrix, apiKey once,
// partial update, negative-price rejection) + AdminShopController
// (404-vs-500 setup state, messages, QR payload incl. customerUrl) +
// AdminPricingController (GET/PUT by principal shopId).

export const DEFAULT_PRICING_PAISE: Record<string, number> = {
  bwA4Single: 200,
  bwA4Double: 300,
  colorA4Single: 1000,
  colorA4Double: 1500,
  bwA3Single: 500,
  bwA3Double: 800,
  colorA3Single: 2000,
  colorA3Double: 3500,
  passportPrice: 5000,
};

export class ShopAdminError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400
  ) {
    super(message);
  }
}

export interface ShopAdminRow {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  apiKey: string | null;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isOpen: boolean | null;
}

export interface ShopPricingRowFull {
  id: string;
  shopId: string;
  bwA4Single: string;
  bwA4Double: string;
  colorA4Single: string;
  colorA4Double: string;
  bwA3Single: string;
  bwA3Double: string;
  colorA3Single: string;
  colorA3Double: string;
  passportPrice: string;
}

export interface ShopAdminStore {
  findUserById(userId: string): Promise<{ id: string; shopId: string | null } | null>;
  slugExists(slug: string): Promise<boolean>;
  createShop(input: {
    name: string;
    slug: string;
    ownerName: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    logoUrl: string | null;
    apiKey: string;
  }): Promise<ShopAdminRow>;
  createDefaultPricing(shopId: string): Promise<void>;
  linkUserShop(userId: string, shopId: string): Promise<void>;
  findShopById(shopId: string): Promise<ShopAdminRow | null>;
  rotateApiKey(shopId: string, apiKey: string): Promise<ShopAdminRow>;
  updateShop(
    shopId: string,
    patch: Partial<{
      name: string;
      address: string | null;
      phone: string | null;
      logoUrl: string | null;
      ownerName: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
      isOpen: boolean | null;
    }>
  ): Promise<ShopAdminRow>;
  findPricingByShopId(shopId: string): Promise<ShopPricingRowFull | null>;
  updatePricing(
    shopId: string,
    patch: Partial<Record<string, string>>
  ): Promise<ShopPricingRowFull>;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function toShopDTO(shop: ShopAdminRow): {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  apiKey: string | null;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isOpen: boolean;
} {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    address: shop.address,
    phone: shop.phone,
    logoUrl: shop.logoUrl,
    apiKey: shop.apiKey,
    ownerName: shop.ownerName,
    city: shop.city,
    state: shop.state,
    pincode: shop.pincode,
    isOpen: shop.isOpen ?? true,
  };
}

export interface PricingDTOBody {
  id: string;
  shopId: string;
  bwA4Single: number;
  bwA4Double: number;
  colorA4Single: number;
  colorA4Double: number;
  bwA3Single: number;
  bwA3Double: number;
  colorA3Single: number;
  colorA3Double: number;
  passportPrice: number;
}

export function toPricingDTO(p: ShopPricingRowFull): PricingDTOBody {
  const num = (decimal: string): number => {
    const paise = decimalToPaise(decimal);
    const neg = paise < 0;
    const abs = Math.abs(paise);
    const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
    return Number(neg ? `-${text}` : text);
  };
  return {
    id: p.id,
    shopId: p.shopId,
    bwA4Single: num(p.bwA4Single),
    bwA4Double: num(p.bwA4Double),
    colorA4Single: num(p.colorA4Single),
    colorA4Double: num(p.colorA4Double),
    bwA3Single: num(p.bwA3Single),
    bwA3Double: num(p.bwA3Double),
    colorA3Single: num(p.colorA3Single),
    colorA3Double: num(p.colorA3Double),
    passportPrice: num(p.passportPrice),
  };
}

export async function createShop(
  store: ShopAdminStore,
  userId: string,
  input: {
    name: unknown;
    ownerName?: unknown;
    phone?: unknown;
    address?: unknown;
    city?: unknown;
    state?: unknown;
    pincode?: unknown;
    logoUrl?: unknown;
  }
): Promise<ReturnType<typeof toShopDTO>> {
  assertServerRuntime("createShop");
  const user = await store.findUserById(userId);
  if (user == null) {
    throw new ShopAdminError("User not found", 400);
  }
  if (user.shopId != null) {
    throw new ShopAdminError("User already has a shop", 400);
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new ShopAdminError("Shop name is required", 400);
  }
  const baseSlug = slugify(input.name);
  let slug = baseSlug;
  let counter = 1;
  while (await store.slugExists(slug)) {
    slug = `${baseSlug}-${counter++}`;
  }
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const shop = await store.createShop({
    name: input.name,
    slug,
    ownerName: str(input.ownerName),
    phone: str(input.phone),
    address: str(input.address),
    city: str(input.city),
    state: str(input.state),
    pincode: str(input.pincode),
    logoUrl: str(input.logoUrl),
    apiKey: `pa_live_${randomUUID().replace(/-/g, "")}`,
  });
  await store.createDefaultPricing(shop.id);
  await store.linkUserShop(userId, shop.id);
  return toShopDTO(shop);
}

export function requireShopId(principal: { shopId: string | null } | null): string {
  if (principal == null || principal.shopId == null) {
    const err = new ShopAdminError(
      "No shop associated with this account yet. Please complete shop setup.",
      404
    );
    throw err;
  }
  return principal.shopId;
}

export async function regenerateApiKey(
  store: ShopAdminStore,
  shopId: string | null
): Promise<ReturnType<typeof toShopDTO>> {
  assertServerRuntime("regenerateApiKey");
  if (shopId == null) {
    throw new ShopAdminError(
      "No shop associated with this account yet. Please complete shop setup.",
      400
    );
  }
  const shop = await store.findShopById(shopId);
  if (shop == null) {
    throw new ShopAdminError("Shop not found", 400);
  }
  const rotated = await store.rotateApiKey(
    shopId,
    `pa_live_${randomUUID().replace(/-/g, "")}`
  );
  return toShopDTO(rotated);
}

export async function updateShop(
  store: ShopAdminStore,
  shopId: string,
  input: Record<string, unknown>
): Promise<ReturnType<typeof toShopDTO>> {
  assertServerRuntime("updateShop");
  if (input["name"] != null) {
    if (typeof input["name"] !== "string" || input["name"].trim().length === 0) {
      throw new ShopAdminError("Shop name must not be blank", 400);
    }
  }
  const patch: Parameters<ShopAdminStore["updateShop"]>[1] = {};
  for (const key of [
    "name",
    "address",
    "phone",
    "logoUrl",
    "ownerName",
    "city",
    "state",
    "pincode",
    "isOpen",
  ] as const) {
    if (input[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = input[key];
    }
  }
  const updated = await store.updateShop(shopId, patch);
  const dto = toShopDTO(updated);
  dto.apiKey = null;
  return dto;
}

export function shopQrData(
  shop: { slug: string; name: string },
  customerUrl: string
): Record<string, string> {
  return {
    shopSlug: shop.slug,
    shopName: shop.name,
    shopUrl: `/shop/${shop.slug}`,
    fullShopUrl: `${customerUrl}/shop/${shop.slug}`,
  };
}

const PRICING_FIELDS = [
  "bwA4Single",
  "bwA4Double",
  "colorA4Single",
  "colorA4Double",
  "bwA3Single",
  "bwA3Double",
  "colorA3Single",
  "colorA3Double",
  "passportPrice",
] as const;

export async function updateShopPricing(
  store: ShopAdminStore,
  shopId: string,
  input: Record<string, unknown>
): Promise<ReturnType<typeof toPricingDTO>> {
  assertServerRuntime("updateShopPricing");
  const existing = await store.findPricingByShopId(shopId);
  if (existing == null) {
    throw new ShopAdminError("Pricing not found for shop", 400);
  }
  const patch: Partial<Record<string, string>> = {};
  for (const field of PRICING_FIELDS) {
    const v = input[field];
    if (v === undefined || v === null) {
      continue;
    }
    const paise =
      typeof v === "number"
        ? Math.round(v * 100)
        : decimalToPaise(String(v));
    if (paise < 0) {
      throw new ShopAdminError(`Pricing field '${field}' must not be negative`, 400);
    }
    patch[field] = paiseToDecimal(paise);
  }
  const updated = await store.updatePricing(shopId, patch);
  return toPricingDTO(updated);
}
