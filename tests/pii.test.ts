import { describe, it, expect } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { canViewWorkerPii, maskWorker } from "@/lib/auth/pii";
import { ROLE_CAPABILITIES } from "@/lib/auth/capabilities";
import type { AuthContext } from "@/lib/auth/types";

function ctxFor(role: MembershipRole): AuthContext {
  const isFacility = role === "FACILITY_ADMIN" || role === "FACILITY_STAFF";
  return {
    userId: "u",
    membershipId: "m",
    scopeType: isFacility ? "FACILITY" : "CUSTOMER",
    scopeId: isFacility ? null : "t1",
    tenantId: isFacility ? null : "t1",
    supplierId: null,
    role,
    capabilities: ROLE_CAPABILITIES[role],
    workerId: null,
  };
}

const worker = {
  id: "w1",
  firstName: "João",
  lastName: "Silva",
  email: "joao@acme.pt",
  department: "Operations",
};

describe("worker PII masking (decision #2)", () => {
  it("HR sees full PII", () => {
    const ctx = ctxFor("HR_MANAGER");
    expect(canViewWorkerPii(ctx)).toBe(true);
    expect(maskWorker(worker, ctx)).toEqual(worker);
  });

  it("FACILITY_STAFF gets masked names + null email, but keeps non-PII", () => {
    const ctx = ctxFor("FACILITY_STAFF");
    expect(canViewWorkerPii(ctx)).toBe(false);
    const masked = maskWorker(worker, ctx);
    expect(masked.firstName).toBe("—");
    expect(masked.lastName).toBe("—");
    expect(masked.email).toBeNull();
    expect(masked.department).toBe("Operations");
  });

  it("FACILITY_ADMIN sees full PII", () => {
    const masked = maskWorker(worker, ctxFor("FACILITY_ADMIN"));
    expect(masked.email).toBe("joao@acme.pt");
    expect(masked.lastName).toBe("Silva");
  });
});
