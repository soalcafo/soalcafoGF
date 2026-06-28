// Single source of truth for authorization capabilities.
// Mirrors docs/ARCHITECTURE.md §4 (roles & permissions matrix). A CI test
// (tests/capabilities.test.ts) asserts this map matches the documented matrix.
//
// This map answers "can this role perform this capability AT ALL (within its scope)".
// SCOPING (own-tenant vs self-only) and PII masking are enforced separately by the
// RLS layer (prisma/sql/security.sql), forTenant/forWorker, and lib/auth/pii.ts.
import type { MembershipRole } from "@prisma/client";

export const CAPABILITIES = [
  "catalog.training.manage",
  "catalog.training.delete",
  "catalog.browse",
  "supplier.manage",
  "source.configure",
  "ingest.conflict.resolve",
  "customer.create",
  "customer.settings.edit",
  "customer.billing.manage",
  "membership.invite.hr",
  "membership.invite.worker",
  "membership.invite.facilityStaff",
  "worker.manage",
  "worker.read.pii",
  "worker.profile.rectify",
  "assignment.create",
  "assignment.read",
  "completion.record",
  "completion.bulk",
  "completion.reopen",
  "certificate.issue",
  "hours.read.tenant",
  "hours.read.self",
  "report.read",
  "timeline.view.global",
  "timeline.view.tenant",
  "timeline.view.self",
  "gdpr.export",
  "gdpr.erase",
  "audit.read",
  "identityProvider.configure",
  "impersonate.customer",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const FACILITY_ADMIN: Capability[] = [
  "catalog.training.manage",
  "catalog.training.delete",
  "catalog.browse",
  "supplier.manage",
  "source.configure",
  "ingest.conflict.resolve",
  "customer.create",
  "customer.settings.edit",
  "customer.billing.manage",
  "membership.invite.facilityStaff",
  "worker.read.pii", // decision #2: facility ADMINS may view customer worker PII (audited)
  "assignment.read",
  "completion.record",
  "completion.bulk",
  "completion.reopen",
  "certificate.issue",
  "hours.read.tenant",
  "report.read",
  "timeline.view.global",
  "timeline.view.tenant",
  "gdpr.export",
  "gdpr.erase",
  "audit.read",
  "identityProvider.configure",
  "impersonate.customer",
];

const FACILITY_STAFF: Capability[] = [
  "catalog.training.manage",
  "catalog.training.delete",
  "catalog.browse",
  "supplier.manage",
  "source.configure",
  "ingest.conflict.resolve",
  "customer.create",
  "customer.settings.edit",
  "completion.bulk",
  "certificate.issue",
  "hours.read.tenant", // aggregated only — NO worker.read.pii (decision #2)
  "report.read",
  "timeline.view.global",
  "timeline.view.tenant",
  "impersonate.customer",
];

const COMPANY_ADMIN: Capability[] = [
  "catalog.browse",
  "customer.settings.edit",
  "customer.billing.manage",
  "membership.invite.hr",
  "membership.invite.worker",
  "worker.manage",
  "worker.read.pii",
  "worker.profile.rectify",
  "assignment.create",
  "assignment.read",
  "completion.record",
  "completion.bulk",
  "completion.reopen",
  "certificate.issue",
  "hours.read.tenant",
  "hours.read.self",
  "report.read",
  "timeline.view.tenant",
  "gdpr.export",
  "gdpr.erase",
  "audit.read",
  "identityProvider.configure",
];

const HR_MANAGER: Capability[] = [
  "catalog.browse",
  "membership.invite.worker",
  "worker.manage",
  "worker.read.pii",
  "worker.profile.rectify",
  "assignment.create",
  "assignment.read",
  "completion.record",
  "completion.bulk",
  "certificate.issue",
  "hours.read.tenant",
  "hours.read.self",
  "report.read",
  "timeline.view.tenant",
];

// Worker capabilities are SELF-only; the self scoping is enforced by forWorker()
// and object-level checks, not by this map.
const WORKER: Capability[] = [
  "catalog.browse",
  "worker.profile.rectify",
  "assignment.read",
  "hours.read.self",
  "report.read",
  "timeline.view.self",
  "gdpr.export",
  "gdpr.erase",
];

// Phase 4 — supplier self-service portal (not wired in MVP).
const SUPPLIER_PORTAL: Capability[] = ["catalog.training.manage", "catalog.browse"];

export const ROLE_CAPABILITIES: Record<MembershipRole, ReadonlySet<Capability>> = {
  FACILITY_ADMIN: new Set(FACILITY_ADMIN),
  FACILITY_STAFF: new Set(FACILITY_STAFF),
  COMPANY_ADMIN: new Set(COMPANY_ADMIN),
  HR_MANAGER: new Set(HR_MANAGER),
  WORKER: new Set(WORKER),
  SUPPLIER_PORTAL: new Set(SUPPLIER_PORTAL),
};

export function roleHasCapability(role: MembershipRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}
