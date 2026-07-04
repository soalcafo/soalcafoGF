/**
 * Seed: reference data only (idempotent).
 *  - Internal facility training source
 *  - A starter set of training categories (with pt-PT + en names)
 *  - Optionally a facility admin user (only if SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD are set)
 *
 * Runs inside a transaction that sets the facility context so it works whether or
 * not RLS has already been applied (see prisma/sql/security.sql).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Cat = {
  code: string;
  isMandatory: boolean;
  pt: string;
  en: string;
};

const CATEGORIES: Cat[] = [
  { code: "sst", isMandatory: true, pt: "Segurança e Saúde no Trabalho", en: "Health & Safety at Work" },
  { code: "primeiros-socorros", isMandatory: true, pt: "Primeiros Socorros", en: "First Aid" },
  { code: "rgpd", isMandatory: true, pt: "Proteção de Dados (RGPD)", en: "Data Protection (GDPR)" },
  { code: "incendios", isMandatory: true, pt: "Combate a Incêndios", en: "Fire Safety" },
  { code: "tecnica", isMandatory: false, pt: "Formação Técnica", en: "Technical Training" },
  { code: "lideranca", isMandatory: false, pt: "Liderança e Gestão", en: "Leadership & Management" },
  { code: "idiomas", isMandatory: false, pt: "Idiomas", en: "Languages" },
  { code: "soft-skills", isMandatory: false, pt: "Competências Transversais", en: "Soft Skills" },
];

async function main() {
  // Reference data is global (tenantId NULL); under RLS that requires facility context.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT set_config('app.is_facility', 'on', true)`);

    await tx.trainingSource.upsert({
      where: { id: "src_internal" },
      update: { name: "Internal Training", isActive: true },
      create: {
        id: "src_internal",
        sourceType: "INTERNAL",
        kind: "FACILITY",
        name: "Internal Training",
        normalizedName: "internal training",
        slug: "internal",
        provenance: "ADMIN_MANUAL",
        isActive: true,
      },
    });

    for (const c of CATEGORIES) {
      await tx.trainingCategory.upsert({
        where: { code: c.code },
        update: { isMandatory: c.isMandatory },
        create: { code: c.code, isMandatory: c.isMandatory },
      });
      const cat = await tx.trainingCategory.findUniqueOrThrow({ where: { code: c.code } });
      for (const [locale, name] of [["pt-PT", c.pt], ["en", c.en]] as const) {
        await tx.categoryTranslation.upsert({
          where: { categoryId_locale: { categoryId: cat.id, locale } },
          update: { name },
          create: { categoryId: cat.id, locale, name },
        });
      }
    }

    // Global supplier master list (SupplierOrg) — the single shared identities that
    // companies attach to. Managed by the super-admin; facility context is already set.
    const ORGS: Array<[string, string, string]> = [
      ["org_atec", "ATEC", "formacao@atec.pt"],
      ["org_cegoc", "Cegoc", "formacao@cegoc.pt"],
    ];
    for (const [id, name, contactEmail] of ORGS) {
      await tx.supplierOrg.upsert({
        where: { id },
        update: { name, contactEmail },
        create: { id, name, normalizedName: name.toLowerCase(), slug: id.replace(/_/g, "-"), contactEmail },
      });
    }
  }, { timeout: 60000, maxWait: 20000 });

  // Optional demo facility admin (no RLS on User/Membership).
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const argon2 = await import("argon2");
    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail, name: "Facility Admin", passwordHash, emailVerified: new Date() },
    });
    const existingAdmin = await prisma.membership.findFirst({
      where: { userId: user.id, scopeType: "FACILITY", role: "FACILITY_ADMIN" },
    });
    if (existingAdmin) {
      await prisma.membership.update({ where: { id: existingAdmin.id }, data: { status: "ACTIVE" } });
    } else {
      await prisma.membership.create({
        data: { userId: user.id, scopeType: "FACILITY", role: "FACILITY_ADMIN", status: "ACTIVE" },
      });
    }
    console.log(`Seeded facility admin: ${adminEmail}`);
  } else {
    console.log("Skipped admin seed (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create one).");
  }

  if (process.env.SEED_DEMO && adminEmail) {
    await seedDemo(adminEmail);
  }

  if (process.env.SEED_SUPPLIER_EMAIL && process.env.SEED_SUPPLIER_PASSWORD) {
    await seedSupplierLogin(
      process.env.SEED_SUPPLIER_EMAIL,
      process.env.SEED_SUPPLIER_PASSWORD,
      process.env.SEED_SUPPLIER_ID ?? "demo_sup_atec",
      "demo_tenant",
    );
  }

  console.log("Seed complete.");
}

// Demo company so the HR area is immediately usable: gives the admin user a
// COMPANY_ADMIN membership in "Empresa Demo" plus a couple of example suppliers.
async function seedDemo(hrEmail: string) {
  const DEMO = "demo_tenant";
  await prisma.tenant.upsert({
    where: { id: DEMO },
    update: { name: "Worten", slug: "worten" },
    create: { id: DEMO, name: "Worten", slug: "worten" },
  });

  const user = await prisma.user.findUnique({ where: { email: hrEmail } });
  if (user) {
    const existing = await prisma.membership.findFirst({
      where: { userId: user.id, scopeType: "CUSTOMER", tenantId: DEMO, role: "COMPANY_ADMIN" },
    });
    if (!existing) {
      await prisma.membership.create({
        data: { userId: user.id, scopeType: "CUSTOMER", tenantId: DEMO, role: "COMPANY_ADMIN", status: "ACTIVE" },
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', '${DEMO}', true)`);
    // [id, name, isAtec, contactEmail, orgId] — orgId links this company's supplier row
    // to the shared global identity (SupplierOrg) so the same supplier is "one ATEC".
    const demoSuppliers: Array<[string, string, boolean, string, string]> = [
      ["demo_sup_atec", "ATEC", true, "formacao@atec.pt", "org_atec"],
      ["demo_sup_xpto", "Cegoc", false, "formacao@cegoc.pt", "org_cegoc"],
    ];
    for (const [id, name, isAtec, contactEmail, orgId] of demoSuppliers) {
      await tx.supplier.upsert({
        where: { id },
        update: { name, isAtec, contactEmail, orgId },
        create: {
          id,
          tenantId: DEMO,
          orgId,
          name,
          normalizedName: name.toLowerCase(),
          slug: id.replace(/_/g, "-"),
          isAtec,
          contactEmail,
        },
      });
    }
  }, { timeout: 60000, maxWait: 20000 });

  console.log(`Seeded demo company + HR membership (${hrEmail}) + suppliers.`);
}

// Creates a supplier LOGIN: a user + a SUPPLIER_PORTAL membership bound to one
// (tenant, supplier) pair. That user, when they log in, lands in /portal and sees
// only that supplier's data.
async function seedSupplierLogin(email: string, password: string, supplierId: string, tenantId: string) {
  const argon2 = await import("argon2");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: { email: email.toLowerCase(), name: "Fornecedor", passwordHash, emailVerified: new Date() },
  });
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id, scopeType: "SUPPLIER", tenantId, supplierId, role: "SUPPLIER_PORTAL" },
  });
  if (!existing) {
    await prisma.membership.create({
      data: { userId: user.id, scopeType: "SUPPLIER", tenantId, supplierId, role: "SUPPLIER_PORTAL", status: "ACTIVE" },
    });
  }
  console.log(`Seeded supplier login: ${email} -> supplier ${supplierId} in tenant ${tenantId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
