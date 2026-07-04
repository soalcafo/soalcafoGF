import type { MembershipRole, ScopeType } from "@prisma/client";
import type { MembershipSummary, AuthContext } from "./types";

/**
 * Who may access DTP/Certificate (SessionFile) data: the delivering supplier, the owning
 * company's HR, and the facility — NEVER a WORKER. A worker is a CUSTOMER-scope role, so
 * without this explicit gate it would take the HR path and could read every DTP + every other
 * participant's certificate in the company. Pure + centralised so the route, the server actions,
 * and the RLS-scope selector all agree; unit-tested.
 */
export function canAccessSessionFiles(ctx: Pick<AuthContext, "scopeType" | "role" | "tenantId" | "supplierId">): boolean {
  if (ctx.scopeType === "SUPPLIER") return Boolean(ctx.tenantId && ctx.supplierId);
  if (ctx.scopeType === "FACILITY") return true;
  if (ctx.scopeType === "CUSTOMER") return ctx.role !== "WORKER" && Boolean(ctx.tenantId);
  return false;
}

/** The landing area for a given scope/role. */
export function scopeHome(locale: string, scopeType: ScopeType, role: MembershipRole): string {
  if (scopeType === "FACILITY") return `/${locale}/admin`;
  if (scopeType === "SUPPLIER") return `/${locale}/portal`;
  if (role === "WORKER") return `/${locale}/app/me`;
  return `/${locale}/app`; // CUSTOMER HR (COMPANY_ADMIN | HR_MANAGER)
}

// When a user holds several memberships, this picks the default active one.
// HR first (the most common day-to-day persona), then supplier, then vendor, then worker.
const ROLE_PRIORITY: Record<MembershipRole, number> = {
  COMPANY_ADMIN: 0,
  HR_MANAGER: 1,
  SUPPLIER_PORTAL: 2,
  FACILITY_ADMIN: 3,
  FACILITY_STAFF: 4,
  WORKER: 5,
};

export function pickDefaultMembership(
  memberships: MembershipSummary[],
): MembershipSummary | undefined {
  return [...memberships].sort(
    (a, b) => (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9),
  )[0];
}
