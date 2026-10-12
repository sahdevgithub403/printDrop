import { prisma } from "@printdrop/db";
import type { AuthDb, AuthUserRow } from "@printdrop/domain";

// Prisma-backed AuthDb for the auth routes. Deletion/creation semantics
// mirror AuthService exactly; signup assigns ROLE_SHOP_ADMIN
// (AuthService.signup line 80). No behavior beyond the auth contract.
export const prismaAuthDb: AuthDb = {
  async findUserByEmail(email: string): Promise<AuthUserRow | null> {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { shop: true },
    });
    if (user == null) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      password: user.password,
      name: user.name,
      phone: user.phone,
      role: user.role,
      shopId: user.shopId,
      shop:
        user.shop == null
          ? null
          : { id: user.shop.id, name: user.shop.name, slug: user.shop.slug },
    };
  },

  async emailExists(email: string): Promise<boolean> {
    const row = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return row != null;
  },

  async createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    phone: string;
  }): Promise<AuthUserRow> {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        password: input.passwordHash,
        name: input.name,
        phone: input.phone,
        role: "ROLE_SHOP_ADMIN",
        // No database default by design (schema parity): the application
        // sets timestamps, mirroring @PrePersist.
        createdAt: new Date(),
      },
    });
    return {
      id: user.id,
      email: user.email,
      password: user.password,
      name: user.name,
      phone: user.phone,
      role: user.role,
      shopId: user.shopId,
      shop: null,
    };
  },

  async updateUserPassword(
    userId: string,
    passwordHash: string
  ): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    });
  },

  async revokeActiveSessions(
    userId: string,
    reason: string,
    now: Date
  ): Promise<void> {
    await prisma.userSession.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: now, revokedReason: reason },
    });
  },

  async createSession(input: {
    userId: string;
    sessionToken: string;
    deviceId: string;
    deviceName: string | null;
    appVersion: string | null;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await prisma.userSession.create({
      data: {
        userId: input.userId,
        sessionToken: input.sessionToken,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        appVersion: input.appVersion,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        status: "ACTIVE",
      },
    });
  },

  async createResetToken(input: {
    userId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await prisma.passwordResetToken.create({
      data: {
        userId: input.userId,
        token: input.tokenHash,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        used: false,
      },
    });
  },

  async findResetTokenByHash(
    tokenHash: string
  ): Promise<{ userId: string; used: boolean; expiresAt: Date } | null> {
    const row = await prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
    });
    if (row == null) {
      return null;
    }
    return { userId: row.userId, used: row.used, expiresAt: row.expiresAt };
  },

  async markResetTokenUsed(tokenHash: string): Promise<void> {
    await prisma.passwordResetToken.update({
      where: { token: tokenHash },
      data: { used: true },
    });
  },
};
