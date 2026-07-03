import type { MembershipRole, ScopeType } from "@prisma/client";
import type { MembershipSummary } from "./types";

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
