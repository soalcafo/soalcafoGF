import { describe, it, expect, beforeAll, afterAll } from "vitest";

// These tests need a real database AND a connection whose role does NOT bypass RLS.
//  - In CI we connect as the non-superuser `app` role (see .github/workflows/ci.yml).
//  - Against Supabase, the default role + FORCE ROW LEVEL SECURITY enforces RLS.
// If a test here fails by returning TOO MANY rows, the connecting role is bypassing
// RLS — fix that (use a NOBYPASSRLS role) before relying on tenant isolation.
const hasDb = !!process.env.DATABASE_URL;
const ID = (s: string) => `test_iso_${s}`;
const TID1 = ID("t1");
const TID2 = ID("t2");
const W1 = ID("w1");
const W2 = ID("w2");
const SRC = ID("src");
const TR = ID("tr");

let dbm: typeof import("@/lib/db");
let clientm: typeof import("@/lib/db/client");

describe.skipIf(!hasDb)("tenant isolation & cross-tenant integrity (RLS)", () => {
  beforeAll(async () => {
    // Dynamic import so this file loads even when the Prisma client isn't generated
    // (the suite simply skips when there's no DATABASE_URL).
    dbm = await import("@/lib/db");
    clientm = await import("@/lib/db/client");
    const { prisma } = clientm;

    for (const [id, slug] of [[TID1, "a"], [TID2, "b"]] as const) {
      await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: ID(slug) } });
    }
    await dbm.forTenant(TID1, (tx) =>
      tx.worker.upsert({
        where: { id: W1 },
        update: {},
        create: { id: W1, tenantId: TID1, employeeNo: "E1", firstName: "A", lastName: "One" },
      }),
    );
    await dbm.forTenant(TID2, (tx) =>
      tx.worker.upsert({
        where: { id: W2 },
        update: {},
        create: { id: W2, tenantId: TID2, employeeNo: "E2", firstName: "B", lastName: "Two" },
      }),
    );
    await dbm.asFacility(async (tx) => {
      await tx.trainingSource.upsert({
        where: { id: SRC },
        update: {},
        create: { id: SRC, sourceType: "INTERNAL", kind: "FACILITY", name: "iso", normalizedName: "iso", slug: ID("src-slug") },
      });
      await tx.training.upsert({
        where: { id: TR },
        update: {},
        create: { id: TR, sourceId: SRC, title: "Iso", slug: ID("tr-slug"), nominalMinutes: 60, status: "PUBLISHED", requiresSession: false },
      });
    });
  });

  afterAll(async () => {
    if (!dbm) return;
    const { prisma } = clientm;
    await dbm.forTenant(TID1, (tx) => tx.worker.deleteMany({ where: { id: W1 } }));
    await dbm.forTenant(TID2, (tx) => tx.worker.deleteMany({ where: { id: W2 } }));
    await dbm.asFacility(async (tx) => {
      await tx.training.deleteMany({ where: { id: TR } });
      await tx.trainingSource.deleteMany({ where: { id: SRC } });
    });
    await prisma.tenant.deleteMany({ where: { id: { in: [TID1, TID2] } } });
    await prisma.$disconnect();
  });

  it("a tenant-scoped query returns ONLY its own workers", async () => {
    const t1 = await dbm.forTenant(TID1, (tx) =>
      tx.worker.findMany({ where: { id: { in: [W1, W2] } }, select: { id: true } }),
    );
    expect(t1.map((w) => w.id)).toEqual([W1]);

    const t2 = await dbm.forTenant(TID2, (tx) =>
      tx.worker.findMany({ where: { id: { in: [W1, W2] } }, select: { id: true } }),
    );
    expect(t2.map((w) => w.id)).toEqual([W2]);
  });

  it("fails CLOSED with no tenant context (returns nothing, not everything)", async () => {
    const { prisma } = clientm;
    const rows = await prisma.worker.findMany({ where: { id: { in: [W1, W2] } }, select: { id: true } });
    expect(rows).toHaveLength(0);
  });

  it("rejects an enrollment referencing another tenant's worker (composite FK)", async () => {
    await expect(
      dbm.forTenant(TID1, (tx) =>
        tx.enrollment.create({
          data: { tenantId: TID1, workerId: W2, trainingId: TR, plannedMinutes: 60, assignedById: "tester" },
        }),
      ),
    ).rejects.toThrow();
  });
});
