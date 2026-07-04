import "server-only";
import { prisma } from "./client";

/**
 * Ensure a shared supplier login user has an ACTIVE SUPPLIER_PORTAL membership in the given
 * company (tenantId) for the given per-company supplier row (supplierId). Idempotent.
 *
 * This is the primitive behind "one login, one space per client": a supplier that serves
 * several companies is a single global SupplierOrg with a single login User; each time a
 * company is linked to that org (super-admin), we add exactly ONE membership here, which
 * shows up as one more switchable space — never a second login. See docs/DECISIONS.md Round 5.
 *
 * Membership is not tenant-scoped (a login exists before any tenant context), so this runs
 * on the raw client — same rationale as lib/db/auth.ts.
 */
export async function ensureSupplierMembership(params: {
  userId: string;
  tenantId: string;
  supplierId: string;
}) {
  const { userId, tenantId, supplierId } = params;
  return prisma.membership.upsert({
    where: {
      userId_scopeType_tenantId_supplierId_role: {
        userId,
        scopeType: "SUPPLIER",
        tenantId,
        supplierId,
        role: "SUPPLIER_PORTAL",
      },
    },
    update: { status: "ACTIVE" },
    create: {
      userId,
      scopeType: "SUPPLIER",
      tenantId,
      supplierId,
      role: "SUPPLIER_PORTAL",
      status: "ACTIVE",
    },
  });
}
