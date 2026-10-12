import { prisma } from "@printdrop/db";
import type { PrincipalStores } from "@printdrop/domain";

// Prisma-backed principal stores for request authentication.
// API-key comparison stays plaintext (legacy compatibility; hashing the
// stored key is the documented ShopService follow-up, not done here).
export const prismaPrincipalStores: PrincipalStores = {
  async findUserByEmail(email: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, shopId: true },
    });
    return user;
  },

  async findShopIdByApiKey(apiKey: string) {
    const shop = await prisma.shop.findUnique({
      where: { apiKey },
      select: { id: true },
    });
    return shop?.id ?? null;
  },

  async findSessionByToken(sessionToken: string) {
    const row = await prisma.userSession.findUnique({
      where: { sessionToken },
    });
    if (row == null) {
      return null;
    }
    return { id: row.id, status: row.status, expiresAt: row.expiresAt };
  },
};
