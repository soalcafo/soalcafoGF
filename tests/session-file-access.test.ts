import { describe, it, expect } from "vitest";
import { canAccessSessionFiles } from "@/lib/auth/scope";

// Guards the fix for the reviewed HIGH finding: a WORKER must NOT be able to reach DTP/
// Certificate files (they would otherwise take the HR path and read every file in the tenant).
describe("canAccessSessionFiles", () => {
  it("allows company HR (COMPANY_ADMIN + HR_MANAGER)", () => {
    expect(canAccessSessionFiles({ scopeType: "CUSTOMER", role: "HR_MANAGER", tenantId: "t1", supplierId: null })).toBe(true);
    expect(canAccessSessionFiles({ scopeType: "CUSTOMER", role: "COMPANY_ADMIN", tenantId: "t1", supplierId: null })).toBe(true);
  });

  it("DENIES a worker", () => {
    expect(canAccessSessionFiles({ scopeType: "CUSTOMER", role: "WORKER", tenantId: "t1", supplierId: null })).toBe(false);
  });

  it("allows a properly-scoped supplier; denies a broken supplier scope", () => {
    expect(canAccessSessionFiles({ scopeType: "SUPPLIER", role: "SUPPLIER_PORTAL", tenantId: "t1", supplierId: "s1" })).toBe(true);
    expect(canAccessSessionFiles({ scopeType: "SUPPLIER", role: "SUPPLIER_PORTAL", tenantId: "t1", supplierId: null })).toBe(false);
  });

  it("allows facility, denies a customer without a tenant", () => {
    expect(canAccessSessionFiles({ scopeType: "FACILITY", role: "FACILITY_ADMIN", tenantId: null, supplierId: null })).toBe(true);
    expect(canAccessSessionFiles({ scopeType: "CUSTOMER", role: "HR_MANAGER", tenantId: null, supplierId: null })).toBe(false);
  });
});
