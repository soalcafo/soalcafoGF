import type { MembershipRole, ScopeType } from "@prisma/client";
import type { Capability } from "./capabilities";

/** A membership shown in the session (for the scope switcher). */
export type MembershipSummary = {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null; // tenantId or supplierId; null for FACILITY scope
  role: MembershipRole;
  label: string | null; // e.g. the customer company name
};

/** The resolved authorization context returned by requireAuth(). */
export type AuthContext = {
  userId: string;
  membershipId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  tenantId: string | null; // set only when scopeType === "CUSTOMER"
  role: MembershipRole;
  capabilities: ReadonlySet<Capability>;
  workerId: string | null; // set when the membership is a WORKER login
};
