// The ONE place the raw Prisma client is instantiated.
// Do NOT import this anywhere except inside lib/db/** — ESLint enforces it.
// Application code must use forTenant()/forWorker()/asFacility() from "@/lib/db"
// so the tenant-isolation RLS context (app.tenant_id GUC) is always set.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
