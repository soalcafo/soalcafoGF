import { describe, it, expect } from "vitest";
import type { MembershipRole } from "@prisma/client";
import {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  roleHasCapability,
} from "@/lib/auth/capabilities";

const KNOWN = new Set<string>(CAPABILITIES);

describe("capability map integrity", () => {
  it("only grants known capabilities", () => {
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      for (const cap of caps) {
        expect(KNOWN.has(cap), `${role} grants unknown capability "${cap}"`).toBe(true);
      }
    }
  });

  it("defines all six roles", () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([
      "COMPANY_ADMIN",
      "FACILITY_ADMIN",
      "FACILITY_STAFF",
      "HR_MANAGER",
      "SUPPLIER_PORTAL",
      "WORKER",
    ]);
  });
});

describe("decision #2 — facility worker-PII visibility", () => {
  it("FACILITY_ADMIN can read worker PII (audited)", () => {
    expect(roleHasCapability("FACILITY_ADMIN", "worker.read.pii")).toBe(true);
  });
  it("FACILITY_STAFF cannot read worker PII (aggregated only)", () => {
    expect(roleHasCapability("FACILITY_STAFF", "worker.read.pii")).toBe(false);
  });
  it("the owning company's HR and admins can read worker PII", () => {
    expect(roleHasCapability("HR_MANAGER", "worker.read.pii")).toBe(true);
    expect(roleHasCapability("COMPANY_ADMIN", "worker.read.pii")).toBe(true);
  });
});

describe("role boundaries (matrix invariants)", () => {
  it("only facility roles see the global timeline", () => {
    expect(roleHasCapability("FACILITY_ADMIN", "timeline.view.global")).toBe(true);
    expect(roleHasCapability("FACILITY_STAFF", "timeline.view.global")).toBe(true);
    for (const r of ["COMPANY_ADMIN", "HR_MANAGER", "WORKER"] as MembershipRole[]) {
      expect(roleHasCapability(r, "timeline.view.global")).toBe(false);
    }
  });

  it("HR_MANAGER cannot manage billing, read audit, or erase data", () => {
    for (const cap of ["customer.billing.manage", "audit.read", "gdpr.erase"] as const) {
      expect(roleHasCapability("HR_MANAGER", cap)).toBe(false);
    }
  });

  it("WORKER has no tenant-wide capabilities (self-service only)", () => {
    for (const cap of [
      "worker.manage",
      "hours.read.tenant",
      "timeline.view.tenant",
      "assignment.create",
      "catalog.training.manage",
    ] as const) {
      expect(roleHasCapability("WORKER", cap)).toBe(false);
    }
  });

  it("only facility roles manage the catalog", () => {
    expect(roleHasCapability("FACILITY_ADMIN", "catalog.training.manage")).toBe(true);
    expect(roleHasCapability("FACILITY_STAFF", "catalog.training.manage")).toBe(true);
    expect(roleHasCapability("HR_MANAGER", "catalog.training.manage")).toBe(false);
    expect(roleHasCapability("COMPANY_ADMIN", "catalog.training.manage")).toBe(false);
  });
});
