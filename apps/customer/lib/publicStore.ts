import { prisma } from "@printdrop/db";
import type {
  ShopStore,
  ShopRow,
  PricingStore,
  PricingDocumentRow,
  ShopPricingRow,
} from "@printdrop/domain";

// Prisma-backed stores for the public shop/pricing reads. Read-only;
// decimal values cross as exact strings (Prisma Decimal.toString()).
export const prismaShopStore: ShopStore = {
  async findShopBySlug(slug: string): Promise<ShopRow | null> {
    const shop = await prisma.shop.findUnique({ where: { slug } });
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
      ownerName: shop.ownerName,
      city: shop.city,
      state: shop.state,
      pincode: shop.pincode,
      isOpen: shop.isOpen,
    };
  },
};

export const prismaPricingStore: PricingStore = {
  async findDocumentById(
    documentId: string
  ): Promise<PricingDocumentRow | null> {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
    });
    if (doc == null) {
      return null;
    }
    return { pageCount: doc.pageCount };
  },

  async findPricingByShopId(shopId: string): Promise<ShopPricingRow | null> {
    const pricing = await prisma.shopPricing.findUnique({
      where: { shopId },
    });
    if (pricing == null) {
      return null;
    }
    return {
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
};
