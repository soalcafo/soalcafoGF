// Tenant-scoped database access. This is the ONLY supported way to read/write
// tenant-owned data. Each helper opens an interactive transaction and, as its
// FIRST statement, binds the RLS context as a transaction-local GUC via a bound
// parameter (injection-safe). Because the GUC is transaction-local, it is
// guaranteed to share the same pooled connection as the queries inside `fn`
// (correct under Supabase/PgBouncer transaction pooling).
//
// An unset GUC reads as NULL in Postgres, so RLS fails CLOSED (returns nothing)
// rather than leaking — see prisma/sql/security.sql.
import type { Prisma } from "@prisma/client";
import { prisma } from "./client";

/** The transaction-scoped client handed to callbacks. Has the RLS context applied. */
export type TenantClient = Prisma.TransactionClient;

const TX_OPTS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * Run `fn` with the tenant RLS context set to `tenantId`.
 * All queries inside see only that tenant's rows (+ global catalog rows).
 */
export async function forTenant<T>(
  tenantId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new Error("forTenant requires a non-empty tenantId");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }, TX_OPTS);
}

/**
 * Run `fn` with both the tenant context and a worker-self context set.
 * Use for WORKER-role requests; combine with app-level workerId filters.
 */
export async function forWorker<T>(
  tenantId: string,
  workerId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  if (!tenantId || !workerId) throw new Error("forWorker requires tenantId and workerId");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.worker_id', ${workerId}, true)`;
    return fn(tx);
  }, TX_OPTS);
}

/**
 * Run `fn` with the facility cross-tenant read context enabled.
 *
 * ⚠️ Only call this AFTER requireAuth() has confirmed a FACILITY membership with
 * the relevant capability, and write an audit log for any PII access. This grants
 * cross-tenant SELECT visibility (e.g. the global timeline / aggregates).
 * Optionally also pin a specific tenant for scoped facility writes.
 */
export async function asFacility<T>(
  fn: (tx: TenantClient) => Promise<T>,
  opts?: { tenantId?: string },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.is_facility', 'on', true)`;
    if (opts?.tenantId) {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${opts.tenantId}, true)`;
    }
    return fn(tx);
  }, TX_OPTS);
}
