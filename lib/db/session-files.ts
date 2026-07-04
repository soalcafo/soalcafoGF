import "server-only";
import type { AuthContext } from "@/lib/auth/types";
import { canAccessSessionFiles } from "@/lib/auth/scope";
import { forSupplier, forTenant, asFacility, type TenantClient } from "./index";

export { canAccessSessionFiles };

// DTP + Certificate files attached to an Ação (TrainingSession), stored in Postgres. EVERY read
// and write runs inside the caller's own RLS scope, so Postgres — not app code — decides who can
// see a file: a supplier only its own; the owning company (HR) its tenant's; facility all.

type FileKind = "DTP" | "CERTIFICATE" | "OTHER";

function runScoped<T>(ctx: AuthContext, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
  // Single gate (shared with the route + actions): rejects WORKER and any role not allowed.
  if (!canAccessSessionFiles(ctx)) throw new Error("session-files: role not permitted to access session files");
  if (ctx.scopeType === "SUPPLIER") return forSupplier(ctx.tenantId!, ctx.supplierId!, fn);
  if (ctx.scopeType === "FACILITY") return asFacility(fn);
  return forTenant(ctx.tenantId!, fn); // CUSTOMER, non-WORKER (canAccessSessionFiles guaranteed tenantId)
}

export type SessionFileMeta = {
  id: string;
  kind: FileKind;
  fileName: string;
  sizeBytes: number;
  label: string | null;
  uploadedAt: Date;
};

export async function listSessionFiles(ctx: AuthContext, sessionId: string): Promise<SessionFileMeta[]> {
  return runScoped(ctx, (tx) =>
    tx.sessionFile.findMany({
      where: { sessionId },
      orderBy: [{ kind: "asc" }, { uploadedAt: "asc" }],
      select: { id: true, kind: true, fileName: true, sizeBytes: true, label: true, uploadedAt: true },
    }),
  ) as Promise<SessionFileMeta[]>;
}

export async function createSessionFile(
  ctx: AuthContext,
  input: { sessionId: string; kind: FileKind; fileName: string; mimeType: string; data: Uint8Array<ArrayBuffer>; label?: string | null },
) {
  // tenantId/supplierId here are only placeholders — the DB trigger (enforce_sessionfile_lineage)
  // overwrites them from the session's lineage, and RLS WITH CHECK then blocks any mismatch.
  return runScoped(ctx, (tx) =>
    tx.sessionFile.create({
      data: {
        sessionId: input.sessionId,
        tenantId: ctx.tenantId ?? "",
        supplierId: ctx.supplierId ?? null,
        kind: input.kind,
        fileName: input.fileName.slice(0, 200),
        mimeType: input.mimeType.slice(0, 120),
        sizeBytes: input.data.byteLength,
        data: input.data,
        label: input.label?.slice(0, 200) || null,
        uploadedById: ctx.userId,
      },
      select: { id: true },
    }),
  );
}

export async function deleteSessionFile(ctx: AuthContext, id: string) {
  return runScoped(ctx, (tx) => tx.sessionFile.deleteMany({ where: { id } }));
}

export async function readSessionFile(ctx: AuthContext, id: string) {
  return runScoped(ctx, (tx) =>
    tx.sessionFile.findUnique({ where: { id }, select: { fileName: true, mimeType: true, data: true } }),
  );
}
