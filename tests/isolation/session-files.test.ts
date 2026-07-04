import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Proves DTP/Certificate (SessionFile) isolation on the real DB:
//  - a supplier reads ONLY its own session files; never another supplier's
//  - the owning company (HR) reads its tenant's files; a different tenant cannot
//  - the lineage trigger + RLS WITH CHECK make cross-supplier WRITES impossible
//  - unscoped reads fail closed
const hasDb = !!process.env.DATABASE_URL;
const ID = (s: string) => `test_sf_${s}`;
const T = ID("t");
const T2 = ID("t2");
const SA = ID("sa");
const SB = ID("sb");
const TRA = ID("tra");
const TRB = ID("trb");
const SEA = ID("sea");
const SEB = ID("seb");

let dbm: typeof import("@/lib/db");
let clientm: typeof import("@/lib/db/client");
let fileA = "";

describe.skipIf(!hasDb)("session-file (DTP/certificate) isolation", () => {
  beforeAll(async () => {
    dbm = await import("@/lib/db");
    clientm = await import("@/lib/db/client");
    const { prisma } = clientm;

    await prisma.tenant.upsert({ where: { id: T }, update: {}, create: { id: T, name: T, slug: ID("t-slug") } });
    await prisma.tenant.upsert({ where: { id: T2 }, update: {}, create: { id: T2, name: T2, slug: ID("t2-slug") } });

    await dbm.forTenant(T, async (tx) => {
      await tx.supplier.upsert({ where: { id: SA }, update: {}, create: { id: SA, tenantId: T, name: "SA", normalizedName: "sa", slug: ID("sa-slug") } });
      await tx.supplier.upsert({ where: { id: SB }, update: {}, create: { id: SB, tenantId: T, name: "SB", normalizedName: "sb", slug: ID("sb-slug") } });
      await tx.training.upsert({ where: { id: TRA }, update: {}, create: { id: TRA, sourceId: "src_internal", tenantId: T, supplierId: SA, title: "TA", slug: ID("tra-slug"), nominalMinutes: 60, status: "PUBLISHED", requiresSession: true } });
      await tx.training.upsert({ where: { id: TRB }, update: {}, create: { id: TRB, sourceId: "src_internal", tenantId: T, supplierId: SB, title: "TB", slug: ID("trb-slug"), nominalMinutes: 60, status: "PUBLISHED", requiresSession: true } });
      await tx.trainingSession.upsert({ where: { id: SEA }, update: {}, create: { id: SEA, trainingId: TRA, name: "AA", startsAt: new Date("2026-06-01T09:00:00Z"), endsAt: new Date("2026-06-01T17:00:00Z") } });
      await tx.trainingSession.upsert({ where: { id: SEB }, update: {}, create: { id: SEB, trainingId: TRB, name: "AB", startsAt: new Date("2026-06-02T09:00:00Z"), endsAt: new Date("2026-06-02T17:00:00Z") } });
    });

    // Supplier SA uploads a DTP to its own session (SEA).
    const created = await dbm.forSupplier(T, SA, (tx) =>
      tx.sessionFile.create({
        data: { sessionId: SEA, tenantId: T, supplierId: SA, kind: "DTP", fileName: "dtp.pdf", mimeType: "application/pdf", sizeBytes: 3, data: new Uint8Array([1, 2, 3]), uploadedById: "tester" },
        select: { id: true },
      }),
    );
    fileA = created.id;
  });

  afterAll(async () => {
    if (!dbm) return;
    const { prisma } = clientm;
    await dbm.forTenant(T, async (tx) => {
      await tx.sessionFile.deleteMany({ where: { sessionId: { in: [SEA, SEB] } } });
      await tx.trainingSession.deleteMany({ where: { id: { in: [SEA, SEB] } } });
      await tx.training.deleteMany({ where: { id: { in: [TRA, TRB] } } });
      await tx.supplier.deleteMany({ where: { id: { in: [SA, SB] } } });
    });
    await prisma.tenant.deleteMany({ where: { id: { in: [T, T2] } } });
    await prisma.$disconnect();
  });

  it("the owning supplier sees its own file", async () => {
    const rows = await dbm.forSupplier(T, SA, (tx) => tx.sessionFile.findMany({ where: { id: fileA }, select: { id: true } }));
    expect(rows.map((r) => r.id)).toEqual([fileA]);
  });

  it("another supplier in the same company CANNOT see it", async () => {
    const rows = await dbm.forSupplier(T, SB, (tx) => tx.sessionFile.findMany({ where: { id: fileA }, select: { id: true } }));
    expect(rows).toHaveLength(0);
  });

  it("the owning company (HR) CAN see it", async () => {
    const rows = await dbm.forTenant(T, (tx) => tx.sessionFile.findMany({ where: { id: fileA }, select: { id: true } }));
    expect(rows.map((r) => r.id)).toEqual([fileA]);
  });

  it("a different company CANNOT see it", async () => {
    const rows = await dbm.forTenant(T2, (tx) => tx.sessionFile.findMany({ where: { id: fileA }, select: { id: true } }));
    expect(rows).toHaveLength(0);
  });

  it("fails CLOSED: an unscoped read sees nothing", async () => {
    const { prisma } = clientm;
    const rows = await prisma.sessionFile.findMany({ where: { id: fileA }, select: { id: true } });
    expect(rows).toHaveLength(0);
  });

  it("rejects a supplier attaching a file to ANOTHER supplier's session (trigger + WITH CHECK)", async () => {
    await expect(
      dbm.forSupplier(T, SB, (tx) =>
        tx.sessionFile.create({
          data: { sessionId: SEA, tenantId: T, supplierId: SB, kind: "DTP", fileName: "evil.pdf", mimeType: "application/pdf", sizeBytes: 1, data: new Uint8Array([9]), uploadedById: "attacker" },
        }),
      ),
    ).rejects.toThrow();
  });
});
