import type { AuthContext } from "./types";

// Worker PII visibility (decision #2):
//   - The owning company's HR / COMPANY_ADMIN, and FACILITY_ADMIN (audited) → see PII.
//   - FACILITY_STAFF → aggregated/anonymized only.
// The `worker.read.pii` capability encodes exactly this (see lib/auth/capabilities.ts);
// RLS independently guarantees a session only ever reaches its own tenant's rows.

export function canViewWorkerPii(ctx: AuthContext): boolean {
  return ctx.capabilities.has("worker.read.pii");
}

type WorkerLike = {
  firstName: string;
  lastName: string;
  email?: string | null;
  [key: string]: unknown;
};

/** Returns the worker as-is for PII-cleared contexts, otherwise a masked copy. */
export function maskWorker<T extends WorkerLike>(worker: T, ctx: AuthContext): T {
  if (canViewWorkerPii(ctx)) return worker;
  return {
    ...worker,
    firstName: "—",
    lastName: "—",
    email: null,
  };
}

/** Mask a list of workers in one call. */
export function maskWorkers<T extends WorkerLike>(workers: T[], ctx: AuthContext): T[] {
  if (canViewWorkerPii(ctx)) return workers;
  return workers.map((w) => maskWorker(w, ctx));
}
