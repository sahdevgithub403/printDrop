import { PrismaClient } from "@prisma/client";

// Singleton: Next.js dev/hot-reload must share one PrismaClient per process.
// Server-only: database credentials must never load in browser code.
const hasWindow =
  typeof globalThis !== "undefined" &&
  (globalThis as Record<string, unknown>)["window"] !== undefined;
if (hasWindow) {
  throw new Error(
    "@printdrop/db is server-only and must not be imported from browser code"
  );
}
const globalForPrisma = globalThis as unknown as {
  __printdropPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__printdropPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__printdropPrisma = prisma;
}

export default prisma;
