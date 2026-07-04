import type { MembershipRole, ScopeType } from "@prisma/client";
import type { Capability } from "./capabilities";

/** A membership shown in the session (for the scope switcher). */
export type MembershipSummary = {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null; // tenantId or supplierId; null for FACILITY scope
  tenantId: string | null; // set for CUSTOMER and SUPPLIER scopes
  supplierId: string | null; // set only when scopeType === "SUPPLIER"
  role: MembershipRole;
  label: string | null; // e.g. the customer company name (the "space" the user switches into)
};

/** The resolved authorization context returned by requireAuth(). */
export type AuthContext = {
  userId: string;
  membershipId: string;
  scopeType: ScopeType;
  scopeId: string | null; // DEPRECATED for data-access decisions — use tenantId/supplierId
  tenantId: string | null; // set for CUSTOMER and SUPPLIER scopes
  supplierId: string | null; // set only when scopeType === "SUPPLIER"
  role: MembershipRole;
  capabilities: ReadonlySet<Capability>;
  workerId: string | null; // set when the membership is a WORKER login
};
