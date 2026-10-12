import { prisma } from "@printdrop/db";
import {
  DEFAULT_PRICING_PAISE,
  type ShopAdminStore,
} from "@printdrop/domain";

// Prisma-backed shop/pricing admin store. Default pricing matrix mirrors
// ShopService.createShop paise-for-paise (2/3/10/15/5/8/20/35/50); API
// keys are stored plaintext exactly like the legacy (hashing is the
// documented follow-up, not done here).

function paise(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${text}` : text;
}

export const prismaShopAdminStore: ShopAdminStore = {
  async findUserById(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, shopId: true },
    });
    return user;
  },

  async slugExists(slug: string) {
    const row = await prisma.shop.findUnique({
      where: { slug },
      select: { id: true },
    });
    return row != null;
  },

  async createShop(input) {
    const shop = await prisma.shop.create({
      data: {
        name: input.name,
        slug: input.slug,
        ownerName: input.ownerName,
        phone: input.phone,
        address: input.address,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        logoUrl: input.logoUrl,
        apiKey: input.apiKey,
        isOpen: true,
        createdAt: new Date(),
      },
    });
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
      isOpen: shop.isOpen,
    };
  },

  async createDefaultPricing(shopId: string) {
    await prisma.shopPricing.create({
      data: {
        shopId,
        bwA4Single: paise(DEFAULT_PRICING_PAISE.bwA4Single!),
        bwA4Double: paise(DEFAULT_PRICING_PAISE.bwA4Double!),
        colorA4Single: paise(DEFAULT_PRICING_PAISE.colorA4Single!),
        colorA4Double: paise(DEFAULT_PRICING_PAISE.colorA4Double!),
        bwA3Single: paise(DEFAULT_PRICING_PAISE.bwA3Single!),
        bwA3Double: paise(DEFAULT_PRICING_PAISE.bwA3Double!),
        colorA3Single: paise(DEFAULT_PRICING_PAISE.colorA3Single!),
        colorA3Double: paise(DEFAULT_PRICING_PAISE.colorA3Double!),
        passportPrice: paise(DEFAULT_PRICING_PAISE.passportPrice!),
      },
    });
  },

  async linkUserShop(userId: string, shopId: string) {
    await prisma.user.update({ where: { id: userId }, data: { shopId } });
  },

  async findShopById(shopId: string) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (shop == null) {
      return null;
    }
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
      isOpen: shop.isOpen,
    };
  },

  async rotateApiKey(shopId: string, apiKey: string) {
    const shop = await prisma.shop.update({
      where: { id: shopId },
      data: { apiKey },
    });
    const found = await prismaShopAdminStore.findShopById(shop.id);
    if (found == null) {
      throw new Error("shop vanished during key rotation");
    }
    return found;
  },

  async updateShop(shopId: string, patch) {
    const shop = await prisma.shop.update({
      where: { id: shopId },
      data: { ...patch },
    });
    const found = await prismaShopAdminStore.findShopById(shop.id);
    if (found == null) {
      throw new Error("shop vanished during update");
    }
    return found;
  },

  async findPricingByShopId(shopId: string) {
    const pricing = await prisma.shopPricing.findUnique({ where: { shopId } });
    if (pricing == null) {
      return null;
    }
    return {
      id: pricing.id,
      shopId: pricing.shopId,
      bwA4Single: pricing.bwA4Single.toString(),
      bwA4Double: pricing.bwA4Double.toString(),
      colorA4Single: pricing.colorA4Single.toString(),
      colorA4Double: pricing.colorA4Double.toString(),
      bwA3Single: pricing.bwA3Single.toString(),
      bwA3Double: pricing.bwA3Double.toString(),
      colorA3Single: pricing.colorA3Single.toString(),
      colorA3Double: pricing.colorA3Double.toString(),
      passportPrice: pricing.passportPrice.toString(),
    };
  },

  async updatePricing(shopId: string, patch) {
    const pricing = await prisma.shopPricing.update({
      where: { shopId },
      data: { ...patch },
    });
    const found = await prismaShopAdminStore.findPricingByShopId(shopId);
    if (found == null) {
      throw new Error("pricing vanished during update");
    }
    return found;
  },
};
