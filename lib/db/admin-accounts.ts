import "server-only";
import { prisma } from "./client";
import { asFacility } from "./index";
import { ensureSupplierMembership } from "./provision-supplier-login";

// Super-admin account management (reset password/email/2FA, main/sub accounts) for a company
// or a supplier org. Callers MUST be a FACILITY_ADMIN (the /admin pages + server actions check
// ctx.role). Membership/User are not RLS-scoped, so those run on the raw client; reading a
// supplier org's per-tenant Supplier rows needs facility context (asFacility).

export type Account = {
  userId: string;
  email: string;
  name: string | null;
  isActive: boolean;
  has2FA: boolean;
  role: string;
  isPrimary: boolean;
  spaces: number; // suppliers: how many company spaces this login has
};

/** Mark the first row as the display "main" when none is explicitly primary. */
function withFallbackPrimary(accounts: Account[]): Account[] {
  if (accounts.length > 0 && !accounts.some((a) => a.isPrimary)) accounts[0]!.isPrimary = true;
  return accounts;
}

export async function getCompanyName(tenantId: string): Promise<string | null> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  return t?.name ?? null;
}

export async function getSupplierOrgName(orgId: string): Promise<string | null> {
  return asFacility(async (tx) => {
    const o = await tx.supplierOrg.findUnique({ where: { id: orgId }, select: { name: true } });
    return o?.name ?? null;
  });
}

export async function getCompanyAccounts(tenantId: string): Promise<Account[]> {
  const memberships = await prisma.membership.findMany({
    where: { scopeType: "CUSTOMER", tenantId, status: { not: "REVOKED" } },
    orderBy: [{ isPrimary: "desc" }, { role: "asc" }, { createdAt: "asc" }],
    select: {
      role: true,
      isPrimary: true,
      user: { select: { id: true, email: true, name: true, isActive: true, mfaSecretEnc: true } },
    },
  });
  return withFallbackPrimary(
    memberships.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      isActive: m.user.isActive,
      has2FA: !!m.user.mfaSecretEnc,
      role: m.role,
      isPrimary: m.isPrimary,
      spaces: 1,
    })),
  );
}

export async function getSupplierAccounts(orgId: string): Promise<Account[]> {
  const supplierIds = (await asFacility((tx) => tx.supplier.findMany({ where: { orgId }, select: { id: true } }))).map(
    (s) => s.id,
  );
  if (supplierIds.length === 0) return [];
  const memberships = await prisma.membership.findMany({
    where: { scopeType: "SUPPLIER", role: "SUPPLIER_PORTAL", supplierId: { in: supplierIds }, status: { not: "REVOKED" } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { isPrimary: true, user: { select: { id: true, email: true, name: true, isActive: true, mfaSecretEnc: true } } },
  });
  const byUser = new Map<string, Account>();
  for (const m of memberships) {
    const cur = byUser.get(m.user.id);
    if (cur) {
      cur.spaces += 1;
      cur.isPrimary = cur.isPrimary || m.isPrimary;
    } else {
      byUser.set(m.user.id, {
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        isActive: m.user.isActive,
        has2FA: !!m.user.mfaSecretEnc,
        role: "SUPPLIER_PORTAL",
        isPrimary: m.isPrimary,
        spaces: 1,
      });
    }
  }
  return withFallbackPrimary([...byUser.values()]);
}

// ─── mutations (all keyed by userId; the caller has verified FACILITY_ADMIN) ───

export async function resetPassword(userId: string, newPassword: string) {
  if (!newPassword || newPassword.length < 8) throw new Error("resetPassword: password must be at least 8 characters");
  const argon2 = await import("argon2");
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
}

export async function resetEmail(userId: string, newEmail: string) {
  const email = newEmail.trim().toLowerCase();
  if (!email) throw new Error("resetEmail: email is required");
  const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (clash && clash.id !== userId) throw new Error("resetEmail: that email is already in use");
  await prisma.user.update({ where: { id: userId }, data: { email, emailVerified: null } });
}

/** Clear the (encrypted) TOTP secret so the user must re-enrol 2FA. */
export async function disable2FA(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: null, sessionVersion: { increment: 1 } } });
}

export async function setPrimaryCompanyAccount(tenantId: string, userId: string) {
  await prisma.$transaction([
    prisma.membership.updateMany({ where: { scopeType: "CUSTOMER", tenantId }, data: { isPrimary: false } }),
    prisma.membership.updateMany({ where: { scopeType: "CUSTOMER", tenantId, userId }, data: { isPrimary: true } }),
  ]);
}

export async function setPrimarySupplierAccount(orgId: string, userId: string) {
  const supplierIds = (await asFacility((tx) => tx.supplier.findMany({ where: { orgId }, select: { id: true } }))).map(
    (s) => s.id,
  );
  if (supplierIds.length === 0) return;
  await prisma.$transaction([
    prisma.membership.updateMany({ where: { scopeType: "SUPPLIER", supplierId: { in: supplierIds } }, data: { isPrimary: false } }),
    prisma.membership.updateMany({ where: { scopeType: "SUPPLIER", supplierId: { in: supplierIds }, userId }, data: { isPrimary: true } }),
  ]);
}

/** Add a company account. Primary → COMPANY_ADMIN (main); otherwise HR_MANAGER (sub). */
export async function addCompanyAccount(
  tenantId: string,
  input: { email: string; name: string; password: string; asPrimary?: boolean },
) {
  const email = input.email.trim().toLowerCase();
  if (!email || input.password.length < 8) throw new Error("addCompanyAccount: email and an 8+ char password are required");
  const argon2 = await import("argon2");
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: input.name.trim() || null, passwordHash, emailVerified: new Date() },
  });
  const role = input.asPrimary ? "COMPANY_ADMIN" : "HR_MANAGER";
  const existing = await prisma.membership.findFirst({ where: { userId: user.id, scopeType: "CUSTOMER", tenantId, role } });
  if (!existing) {
    await prisma.membership.create({
      data: { userId: user.id, scopeType: "CUSTOMER", tenantId, role, status: "ACTIVE", isPrimary: !!input.asPrimary },
    });
  }
  if (input.asPrimary) await setPrimaryCompanyAccount(tenantId, user.id);
}

/** Add a supplier account: one login provisioned into EVERY company the org is linked to. */
export async function addSupplierAccount(
  orgId: string,
  input: { email: string; name: string; password: string; asPrimary?: boolean },
) {
  const email = input.email.trim().toLowerCase();
  if (!email || input.password.length < 8) throw new Error("addSupplierAccount: email and an 8+ char password are required");
  const argon2 = await import("argon2");
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: input.name.trim() || null, passwordHash, emailVerified: new Date() },
  });
  const supplierRows = await asFacility((tx) =>
    tx.supplier.findMany({ where: { orgId, deletedAt: null }, select: { id: true, tenantId: true } }),
  );
  for (const s of supplierRows) {
    await ensureSupplierMembership({ userId: user.id, tenantId: s.tenantId, supplierId: s.id });
  }
  if (input.asPrimary) await setPrimarySupplierAccount(orgId, user.id);
}
