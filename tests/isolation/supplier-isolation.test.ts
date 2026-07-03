import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Proves supplier-level isolation on a REAL database under the non-superuser app_user role:
//  - a supplier sees ONLY its own trainings/enrollments (never another supplier's)
//  - a supplier sees ONLY workers ACTIVELY enrolled in its own trainings
//  - a supplier cannot write a row attributed to another supplier
//  - cancelling the last active enrollment removes the worker from the supplier's view (F5)
// HR (no supplier scope) still sees everything in its tenant.
const hasDb = !!process.env.DATABASE_URL;
const ID = (s: string) => `test_sup_${s}`;
const T = ID("t");
const SA = ID("sa");
const SB = ID("sb");
const WA = ID("wa");
const WB = ID("wb");
const TRA = ID("tra");
const TRB = ID("trb");
const EA = ID("ea");
const EB = ID("eb");

let dbm: typeof import("@/lib/db");
let clientm: typeof import("@/lib/db/client");

describe.skipIf(!hasDb)("supplier isolation (RLS)", () => {
  beforeAll(async () => {
    dbm = await import("@/lib/db");
    clientm = await import("@/lib/db/client");
    const { prisma } = clientm;

    await prisma.tenant.upsert({ where: { id: T }, update: {}, create: { id: T, name: T, slug: ID("slug") } });

    await dbm.forTenant(T, async (tx) => {
      await tx.supplier.upsert({ where: { id: SA }, update: {}, create: { id: SA, tenantId: T, name: "Supplier A", normalizedName: "supplier a", slug: ID("sa-slug") } });
      await tx.supplier.upsert({ where: { id: SB }, update: {}, create: { id: SB, tenantId: T, name: "Supplier B", normalizedName: "supplier b", slug: ID("sb-slug") } });
      await tx.worker.upsert({ where: { id: WA }, update: {}, create: { id: WA, tenantId: T, employeeNo: "WA", firstName: "Wa", lastName: "A" } });
      await tx.worker.upsert({ where: { id: WB }, update: {}, create: { id: WB, tenantId: T, employeeNo: "WB", firstName: "Wb", lastName: "B" } });
      await tx.training.upsert({ where: { id: TRA }, update: {}, create: { id: TRA, sourceId: "src_internal", tenantId: T, supplierId: SA, title: "TA", slug: ID("tra-slug"), nominalMinutes: 60, status: "PUBLISHED", requiresSession: false } });
      await tx.training.upsert({ where: { id: TRB }, update: {}, create: { id: TRB, sourceId: "src_internal", tenantId: T, supplierId: SB, title: "TB", slug: ID("trb-slug"), nominalMinutes: 60, status: "PUBLISHED", requiresSession: false } });
      await tx.enrollment.upsert({ where: { id: EA }, update: { status: "ASSIGNED" }, create: { id: EA, tenantId: T, workerId: WA, trainingId: TRA, plannedMinutes: 60, assignedById: "tester", status: "ASSIGNED" } });
      await tx.enrollment.upsert({ where: { id: EB }, update: { status: "ASSIGNED" }, create: { id: EB, tenantId: T, workerId: WB, trainingId: TRB, plannedMinutes: 60, assignedById: "tester", status: "ASSIGNED" } });
    });
  });

  afterAll(async () => {
    if (!dbm) return;
    const { prisma } = clientm;
    await dbm.forTenant(T, async (tx) => {
      await tx.enrollment.deleteMany({ where: { id: { in: [EA, EB] } } });
      await tx.training.deleteMany({ where: { id: { in: [TRA, TRB] } } });
      await tx.worker.deleteMany({ where: { id: { in: [WA, WB] } } });
      await tx.supplier.deleteMany({ where: { id: { in: [SA, SB] } } });
    });
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.$disconnect();
  });

  it("a supplier sees ONLY its own trainings", async () => {
    const a = await dbm.forSupplier(T, SA, (tx) =>
      tx.training.findMany({ where: { id: { in: [TRA, TRB] } }, select: { id: true }, orderBy: { id: "asc" } }),
    );
    expect(a.map((t) => t.id)).toEqual([TRA]);
  });

  it("a supplier sees ONLY its actively-enrolled workers", async () => {
    const a = await dbm.forSupplier(T, SA, (tx) =>
      tx.worker.findMany({ where: { id: { in: [WA, WB] } }, select: { id: true }, orderBy: { id: "asc" } }),
    );
    expect(a.map((w) => w.id)).toEqual([WA]);
  });

  it("a supplier cannot see another supplier's enrollments", async () => {
    const a = await dbm.forSupplier(T, SA, (tx) =>
      tx.enrollment.findMany({ where: { id: { in: [EA, EB] } }, select: { id: true } }),
    );
    expect(a.map((e) => e.id)).toEqual([EA]);
  });

  it("HR (no supplier scope) sees ALL suppliers' trainings and workers", async () => {
    const t = await dbm.forTenant(T, (tx) => tx.training.findMany({ where: { id: { in: [TRA, TRB] } }, select: { id: true } }));
    expect(t).toHaveLength(2);
    const w = await dbm.forTenant(T, (tx) => tx.worker.findMany({ where: { id: { in: [WA, WB] } }, select: { id: true } }));
    expect(w).toHaveLength(2);
  });

  it("rejects a supplier writing into another supplier's training (F2)", async () => {
    await expect(
      dbm.forSupplier(T, SA, (tx) =>
        tx.enrollment.create({ data: { tenantId: T, workerId: WB, trainingId: TRB, plannedMinutes: 60, assignedById: "x" } }),
      ),
    ).rejects.toThrow();
  });

  it("cancelling the last active enrollment removes the worker from the supplier's view (F5)", async () => {
    await dbm.forSupplier(T, SA, (tx) => tx.enrollment.update({ where: { id: EA }, data: { status: "CANCELLED" } }));
    const a = await dbm.forSupplier(T, SA, (tx) => tx.worker.findMany({ where: { id: { in: [WA, WB] } }, select: { id: true } }));
    expect(a).toHaveLength(0);
  });
});
