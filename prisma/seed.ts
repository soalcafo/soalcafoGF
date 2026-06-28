/**
 * Seed: reference data only (idempotent).
 *  - Internal facility training source
 *  - A starter set of training categories (with pt-PT + en names)
 *  - Optionally a facility admin user (only if SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD are set)
 *
 * Runs inside a transaction that sets the facility context so it works whether or
 * not RLS has already been applied (see prisma/sql/security.sql).
 */
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
  });

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
    await prisma.membership.upsert({
      where: {
        userId_scopeType_tenantId_supplierId_role: {
          userId: user.id,
          scopeType: "FACILITY",
          tenantId: null,
          supplierId: null,
          role: "FACILITY_ADMIN",
        },
      },
      update: { status: "ACTIVE" },
      create: { userId: user.id, scopeType: "FACILITY", role: "FACILITY_ADMIN", status: "ACTIVE" },
    });
    console.log(`Seeded facility admin: ${adminEmail}`);
  } else {
    console.log("Skipped admin seed (set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create one).");
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
