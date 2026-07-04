// Auth-only database access. User/Membership/Account tables are NOT tenant-scoped
// (a user exists before any tenant context), so these run on the raw client.
// Kept inside lib/db/** so all raw DB access stays in one place.
import { cache } from "react";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./client";

/** Auth.js adapter, wired to the single Prisma client. Imported by lib/auth. */
export const authAdapter = PrismaAdapter(prisma);

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      locale: true,
      passwordHash: true,
      isActive: true,
      emailVerified: true,
      sessionVersion: true,
    },
  });
}

/** Active memberships for a user — used to populate the session's scope switcher. */
export async function getActiveMembershipsForUser(userId: string) {
  return prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    select: {
      id: true,
      scopeType: true,
      tenantId: true,
      supplierId: true,
      role: true,
      status: true,
      membershipVersion: true,
      workerId: true,
      tenant: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Load a single membership for per-request authorization. The JWT carries WHO and
 * WHICH membership; capabilities/role/status are re-read here on every request so a
 * downgrade or suspension takes effect immediately (cache this with a short TTL).
 */
// Cached per request so requireAuth() called in both a layout and its page hits the DB once.
export const getMembershipById = cache((membershipId: string) =>
  prisma.membership.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      userId: true,
      scopeType: true,
      tenantId: true,
      supplierId: true,
      role: true,
      status: true,
      membershipVersion: true,
      workerId: true,
    },
  }),
);
