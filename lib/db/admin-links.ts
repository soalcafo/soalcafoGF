import "server-only";
import { prisma } from "./client";
import { asFacility } from "./index";
import { ensureSupplierMembership } from "./provision-supplier-login";

// Super-admin (facility) operations behind the company<->supplier map. All reads/writes run
// under asFacility (is_facility='on'), so they can see and touch every tenant's Supplier rows
// and the global SupplierOrg master list. The caller MUST have verified a FACILITY membership
// with the supplier.manage capability first (the /admin layout + requireAuth do this).

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item"
  );
}

export type MapData = {
  companies: { id: string; name: string; logoUrl: string | null }[];
  orgs: { id: string; name: string; contactEmail: string | null }[];
  // one entry per active company<->org link (the per-tenant Supplier row)
  links: { tenantId: string; orgId: string; supplierId: string }[];
};

/** Everything the map needs: all companies, the master supplier list, and current links. */
export async function getMap(): Promise<MapData> {
  return asFacility(async (tx) => {
    const companies = await tx.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, logoUrl: true },
    });
    const orgs = await tx.supplierOrg.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, contactEmail: true },
    });
    const suppliers = await tx.supplier.findMany({
      where: { deletedAt: null, orgId: { not: null } },
      select: { id: true, tenantId: true, orgId: true },
    });
    const links = suppliers.map((s) => ({ tenantId: s.tenantId, orgId: s.orgId as string, supplierId: s.id }));
    return { companies, orgs, links };
  });
}

/** Add an entry to the master supplier list (the single, shared supplier identity). */
export async function createSupplierOrg(input: { name: string; contactEmail?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new Error("createSupplierOrg: name is required");
  await asFacility(async (tx) => {
    await tx.supplierOrg.create({
      data: {
        name,
        normalizedName: name.toLowerCase(),
        slug: `${slugify(name)}-${Date.now().toString(36)}`,
        contactEmail: input.contactEmail?.trim() || null,
      },
    });
  });
}

/**
 * Link a company to a supplier org: create (or reactivate) that company's per-tenant Supplier
 * row pointing at the org, then extend every existing login of that org with a space in the
 * newly linked company (single login, one space per client). Idempotent.
 */
export async function linkCompanyToSupplierOrg(tenantId: string, orgId: string) {
  const { supplierId, loginUserIds } = await asFacility(async (tx) => {
    const org = await tx.supplierOrg.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) throw new Error("linkCompanyToSupplierOrg: supplier org not found");

    const existing = await tx.supplier.findFirst({ where: { tenantId, orgId }, select: { id: true } });
    let supplierId: string;
    if (existing) {
      await tx.supplier.update({ where: { id: existing.id }, data: { deletedAt: null, status: "ACTIVE", name: org.name } });
      supplierId = existing.id;
    } else {
      const created = await tx.supplier.create({
        data: {
          tenantId,
          orgId,
          name: org.name,
          normalizedName: org.name.toLowerCase(),
          slug: `${slugify(org.name)}-${orgId.slice(-6)}`,
          isAtec: org.name.toLowerCase() === "atec",
        },
        select: { id: true },
      });
      supplierId = created.id;
    }

    // The org's existing logins = users with an ACTIVE supplier membership on ANY of the org's
    // per-company supplier rows. Each should also get a space in this newly linked company.
    const orgSupplierIds = (await tx.supplier.findMany({ where: { orgId }, select: { id: true } })).map((s) => s.id);
    const memberships = await tx.membership.findMany({
      where: { scopeType: "SUPPLIER", role: "SUPPLIER_PORTAL", status: "ACTIVE", supplierId: { in: orgSupplierIds } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return { supplierId, loginUserIds: memberships.map((m) => m.userId) };
  });

  for (const userId of loginUserIds) {
    await ensureSupplierMembership({ userId, tenantId, supplierId });
  }
}

/**
 * Unlink a company from a supplier org: soft-delete that company's Supplier row (so it drops
 * out of HR pickers and the map) and suspend the org's login memberships for that company (so
 * the supplier loses that space). Existing course rows keep their historical supplierId.
 */
export async function unlinkCompanyFromSupplierOrg(tenantId: string, orgId: string) {
  const supplierId = await asFacility(async (tx) => {
    const sup = await tx.supplier.findFirst({ where: { tenantId, orgId, deletedAt: null }, select: { id: true } });
    if (!sup) return null;
    await tx.supplier.update({ where: { id: sup.id }, data: { deletedAt: new Date(), status: "SUSPENDED" } });
    return sup.id;
  });
  if (supplierId) {
    await prisma.membership.updateMany({
      where: { scopeType: "SUPPLIER", supplierId, status: "ACTIVE" },
      data: { status: "SUSPENDED" },
    });
  }
}
