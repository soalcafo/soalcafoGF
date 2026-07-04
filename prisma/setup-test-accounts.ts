/**
 * One-off, idempotent test-account setup. Run with the password in an env var:
 *   $env:TEST_ACCOUNT_PASSWORD = "..."; npx tsx prisma/setup-test-accounts.ts
 *
 * Creates the demo login structure:
 *   - sofia.fonseca98@gmail.com  -> platform super-admin ONLY (FACILITY_ADMIN); Worten HR removed
 *   - worten@test.pt             -> Worten company admin (COMPANY_ADMIN, main)
 *   - fnac@test.pt               -> FNAC company admin (COMPANY_ADMIN, main)
 *   - atec@test.pt               -> ATEC supplier main login (all companies ATEC is linked to)
 *   - btraining@test.pt          -> new "BTraining" supplier, linked to Worten
 * The legacy formacao@atec.pt supplier memberships are revoked so atec@test.pt is THE ATEC login.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PW = process.env.TEST_ACCOUNT_PASSWORD;

const WORTEN = "demo_tenant";
const FNAC = "demo_tenant_fnac";

async function facility<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      `SELECT set_config('app.supplier_id','',true), set_config('app.session_kind','',true), set_config('app.is_facility','on',true)`,
    );
    return fn(tx as unknown as PrismaClient);
  }, { timeout: 60000, maxWait: 20000 });
}

async function upsertUser(email: string, name: string, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash, emailVerified: new Date() },
  });
}

async function ensureCompanyAdmin(userId: string, tenantId: string) {
  const existing = await prisma.membership.findFirst({
    where: { userId, scopeType: "CUSTOMER", tenantId, role: "COMPANY_ADMIN" },
  });
  if (existing) {
    await prisma.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE", isPrimary: true } });
    return;
  }
  await prisma.membership.create({
    data: { userId, scopeType: "CUSTOMER", tenantId, role: "COMPANY_ADMIN", status: "ACTIVE", isPrimary: true },
  });
}

async function ensureSupplierMembership(userId: string, tenantId: string, supplierId: string, isPrimary: boolean) {
  const existing = await prisma.membership.findFirst({
    where: { userId, scopeType: "SUPPLIER", tenantId, supplierId, role: "SUPPLIER_PORTAL" },
  });
  if (existing) {
    await prisma.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE", isPrimary } });
    return;
  }
  await prisma.membership.create({
    data: { userId, scopeType: "SUPPLIER", tenantId, supplierId, role: "SUPPLIER_PORTAL", status: "ACTIVE", isPrimary },
  });
}

async function main() {
  if (!PW || PW.length < 8) {
    console.error("Set TEST_ACCOUNT_PASSWORD (8+ chars) before running.");
    process.exit(1);
  }
  const argon2 = await import("argon2");
  const passwordHash = await argon2.hash(PW, { type: argon2.argon2id });

  // 1. sofia = platform super-admin only.
  const sofia = await prisma.user.findUnique({ where: { email: "sofia.fonseca98@gmail.com" } });
  if (sofia) {
    await prisma.membership.deleteMany({ where: { userId: sofia.id, scopeType: "CUSTOMER" } });
    const fac = await prisma.membership.findFirst({ where: { userId: sofia.id, scopeType: "FACILITY", role: "FACILITY_ADMIN" } });
    if (fac) await prisma.membership.update({ where: { id: fac.id }, data: { status: "ACTIVE" } });
    else await prisma.membership.create({ data: { userId: sofia.id, scopeType: "FACILITY", role: "FACILITY_ADMIN", status: "ACTIVE" } });
    console.log("sofia.fonseca98@gmail.com -> platform super-admin only");
  }

  // 2 & 3. Company admins.
  const worten = await upsertUser("worten@test.pt", "Worten", passwordHash);
  await ensureCompanyAdmin(worten.id, WORTEN);
  const fnac = await upsertUser("fnac@test.pt", "FNAC", passwordHash);
  await ensureCompanyAdmin(fnac.id, FNAC);
  console.log("worten@test.pt -> Worten admin ; fnac@test.pt -> FNAC admin");

  // 4. ATEC supplier main login across every company ATEC is linked to.
  const atec = await upsertUser("atec@test.pt", "ATEC", passwordHash);
  const atecSuppliers = await facility((tx) =>
    tx.supplier.findMany({ where: { orgId: "org_atec", deletedAt: null }, select: { id: true, tenantId: true } }),
  );
  for (const s of atecSuppliers) await ensureSupplierMembership(atec.id, s.tenantId, s.id, true);
  const oldAtec = await prisma.user.findUnique({ where: { email: "formacao@atec.pt" } });
  if (oldAtec) {
    await prisma.membership.updateMany({ where: { userId: oldAtec.id, scopeType: "SUPPLIER" }, data: { status: "REVOKED" } });
  }
  console.log(`atec@test.pt -> ATEC supplier main (${atecSuppliers.length} spaces); legacy formacao@atec.pt revoked`);

  // 5. BTraining: new supplier org, linked to Worten, with its own login.
  const btOrgId = "org_btraining";
  await facility(async (tx) => {
    await tx.supplierOrg.upsert({
      where: { id: btOrgId },
      update: { name: "BTraining", contactEmail: "btraining@test.pt" },
      create: { id: btOrgId, name: "BTraining", normalizedName: "btraining", slug: "org-btraining", contactEmail: "btraining@test.pt" },
    });
    const existing = await tx.supplier.findFirst({ where: { tenantId: WORTEN, orgId: btOrgId } });
    if (existing) {
      await tx.supplier.update({ where: { id: existing.id }, data: { deletedAt: null, status: "ACTIVE", name: "BTraining" } });
    } else {
      await tx.supplier.create({
        data: { tenantId: WORTEN, orgId: btOrgId, name: "BTraining", normalizedName: "btraining", slug: "sup-btraining-worten" },
      });
    }
  });
  const bt = await upsertUser("btraining@test.pt", "BTraining", passwordHash);
  const btSuppliers = await facility((tx) =>
    tx.supplier.findMany({ where: { orgId: btOrgId, deletedAt: null }, select: { id: true, tenantId: true } }),
  );
  for (const s of btSuppliers) await ensureSupplierMembership(bt.id, s.tenantId, s.id, true);
  console.log(`btraining@test.pt -> BTraining supplier (${btSuppliers.length} space), linked to Worten`);

  console.log("Test accounts ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
