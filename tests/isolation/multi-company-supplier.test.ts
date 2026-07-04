import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Proves "one login, one space per client" holds at the DATA layer: a single supplier user
// with SUPPLIER memberships in TWO companies (A and B) stays fully isolated per company —
//  - acting AS company A, it sees A's Ação (TrainingSession) but NOT B's, and vice-versa;
//  - the parent Training is equally walled off;
//  - and the one user genuinely holds exactly two ACTIVE supplier memberships (two spaces),
//    which is what the space-switcher moves between.
// The switch itself (Auth.js unstable_update) needs a request context and is covered by code
// review; here we prove the underlying RLS + membership shape it relies on.
const hasDb = !!process.env.DATABASE_URL;
const ID = (s: string) => `test_mc_${s}`;
const CA = ID("company_a");
const CB = ID("company_b");
const SUP_A = ID("sup_a");
const SUP_B = ID("sup_b");
const TR_A = ID("tr_a");
const TR_B = ID("tr_b");
const SE_A = ID("se_a");
const SE_B = ID("se_b");
const USER = ID("user");
const EMAIL = "test_mc_supplier@example.test";

let dbm: typeof import("@/lib/db");
let clientm: typeof import("@/lib/db/client");

describe.skipIf(!hasDb)("multi-company supplier isolation (one login, many spaces)", () => {
  beforeAll(async () => {
    dbm = await import("@/lib/db");
    clientm = await import("@/lib/db/client");
    const { prisma } = clientm;

    await prisma.tenant.upsert({ where: { id: CA }, update: {}, create: { id: CA, name: CA, slug: ID("a-slug") } });
    await prisma.tenant.upsert({ where: { id: CB }, update: {}, create: { id: CB, name: CB, slug: ID("b-slug") } });

    // Company A: supplier + training + Ação
    await dbm.forTenant(CA, async (tx) => {
      await tx.supplier.upsert({ where: { id: SUP_A }, update: {}, create: { id: SUP_A, tenantId: CA, name: "ATEC", normalizedName: "atec", slug: ID("sup-a-slug") } });
      await tx.training.upsert({ where: { id: TR_A }, update: {}, create: { id: TR_A, sourceId: "src_internal", tenantId: CA, supplierId: SUP_A, title: "Curso A", slug: ID("tr-a-slug"), nominalMinutes: 60, status: "PUBLISHED", requiresSession: true } });
      await tx.trainingSession.upsert({ where: { id: SE_A }, update: {}, create: { id: SE_A, trainingId: TR_A, name: "Ação A", startsAt: new Date("2026-06-01T09:00:00Z"), endsAt: new Date("2026-06-01T17:00:00Z") } });
    });

    // Company B: supplier + training + Ação
    await dbm.forTenant(CB, async (tx) => {
      await tx.supplier.upsert({ where: { id: SUP_B }, update: {}, create: { id: SUP_B, tenantId: CB, name: "ATEC", normalizedName: "atec", slug: ID("sup-b-slug") } });
      await tx.training.upsert({ where: { id: TR_B }, update: {}, create: { id: TR_B, sourceId: "src_internal", tenantId: CB, supplierId: SUP_B, title: "Curso B", slug: ID("tr-b-slug"), nominalMinutes: 60, status: "PUBLISHED", requiresSession: true } });
      await tx.trainingSession.upsert({ where: { id: SE_B }, update: {}, create: { id: SE_B, trainingId: TR_B, name: "Ação B", startsAt: new Date("2026-06-15T09:00:00Z"), endsAt: new Date("2026-06-15T17:00:00Z") } });
    });

    // One login user with a SUPPLIER membership in BOTH companies (the two switchable spaces).
    await prisma.user.upsert({ where: { id: USER }, update: {}, create: { id: USER, email: EMAIL, name: "Multi-space supplier" } });
    for (const [tenantId, supplierId] of [[CA, SUP_A], [CB, SUP_B]] as const) {
      const existing = await prisma.membership.findFirst({ where: { userId: USER, scopeType: "SUPPLIER", tenantId, supplierId, role: "SUPPLIER_PORTAL" } });
      if (!existing) {
        await prisma.membership.create({ data: { userId: USER, scopeType: "SUPPLIER", tenantId, supplierId, role: "SUPPLIER_PORTAL", status: "ACTIVE" } });
      }
    }
  });

  afterAll(async () => {
    if (!dbm) return;
    const { prisma } = clientm;
    await prisma.membership.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await dbm.forTenant(CA, async (tx) => {
      await tx.trainingSession.deleteMany({ where: { id: SE_A } });
      await tx.training.deleteMany({ where: { id: TR_A } });
      await tx.supplier.deleteMany({ where: { id: SUP_A } });
    });
    await dbm.forTenant(CB, async (tx) => {
      await tx.trainingSession.deleteMany({ where: { id: SE_B } });
      await tx.training.deleteMany({ where: { id: TR_B } });
      await tx.supplier.deleteMany({ where: { id: SUP_B } });
    });
    await prisma.tenant.deleteMany({ where: { id: { in: [CA, CB] } } });
    await prisma.$disconnect();
  });

  it("acting AS company A, sees A's Ação but NOT B's", async () => {
    const rows = await dbm.forSupplier(CA, SUP_A, (tx) =>
      tx.trainingSession.findMany({ where: { id: { in: [SE_A, SE_B] } }, select: { id: true }, orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id)).toEqual([SE_A]);
  });

  it("acting AS company B, sees B's Ação but NOT A's", async () => {
    const rows = await dbm.forSupplier(CB, SUP_B, (tx) =>
      tx.trainingSession.findMany({ where: { id: { in: [SE_A, SE_B] } }, select: { id: true }, orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id)).toEqual([SE_B]);
  });

  it("acting AS company A, the parent Training is also walled off from B", async () => {
    const rows = await dbm.forSupplier(CA, SUP_A, (tx) =>
      tx.training.findMany({ where: { id: { in: [TR_A, TR_B] } }, select: { id: true }, orderBy: { id: "asc" } }),
    );
    expect(rows.map((r) => r.id)).toEqual([TR_A]);
  });

  it("fails CLOSED: an unscoped query sees no Ações at all", async () => {
    const { prisma } = clientm;
    const rows = await prisma.trainingSession.findMany({ where: { id: { in: [SE_A, SE_B] } }, select: { id: true } });
    expect(rows).toHaveLength(0);
  });

  it("HR of company A sees only A's Ação (never B's)", async () => {
    const rows = await dbm.forTenant(CA, (tx) =>
      tx.trainingSession.findMany({ where: { id: { in: [SE_A, SE_B] } }, select: { id: true } }),
    );
    expect(rows.map((r) => r.id)).toEqual([SE_A]);
  });

  it("the single login genuinely holds two ACTIVE supplier spaces (A and B)", async () => {
    const { prisma } = clientm;
    const memberships = await prisma.membership.findMany({
      where: { userId: USER, scopeType: "SUPPLIER", status: "ACTIVE" },
      select: { tenantId: true, supplierId: true },
      orderBy: { tenantId: "asc" },
    });
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.tenantId)).toEqual([CA, CB]);
    expect(memberships.map((m) => m.supplierId)).toEqual([SUP_A, SUP_B]);
  });
});
