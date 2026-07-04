import "server-only";
import { redirect } from "next/navigation";
import { auth } from "./index";
import { getMembershipById } from "@/lib/db/auth";
import { ROLE_CAPABILITIES, type Capability } from "./capabilities";
import type { AuthContext } from "./types";

/** Thrown when an authenticated user lacks the required capability (→ HTTP 403). */
export class ForbiddenError extends Error {
  constructor(public readonly capability?: Capability) {
    super(capability ? `Missing capability: ${capability}` : "Forbidden");
    this.name = "ForbiddenError";
  }
}

/**
 * Server-side authorization gate. Call at the top of every Server Action /
 * Route Handler that touches tenant data.
 *
 * - Redirects to /login if unauthenticated or the active membership is gone/inactive.
 * - The session JWT identifies WHO and WHICH membership; role/status/capabilities are
 *   re-read from the DB here on every request, so a downgrade/suspension takes effect
 *   immediately. (Wrap getMembershipById in a short-TTL cache before production.)
 * - Throws ForbiddenError if `opts.capability` is required but not granted.
 *
 * Returns the AuthContext; pass `ctx.tenantId` to forTenant() for data access.
 */
export async function requireAuth(opts?: { capability?: Capability }): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user?.id || !session.activeMembershipId) {
    redirect("/login");
  }

  const membership = await getMembershipById(session.activeMembershipId);
  // Re-check ownership + status on every request: the active membership must still exist,
  // still belong to THIS user (defence in depth for the space-switch path), and be ACTIVE.
  if (!membership || membership.userId !== session.user.id || membership.status !== "ACTIVE") {
    redirect("/login");
  }

  const capabilities = ROLE_CAPABILITIES[membership.role] ?? new Set<Capability>();
  if (opts?.capability && !capabilities.has(opts.capability)) {
    throw new ForbiddenError(opts.capability);
  }

  return {
    userId: session.user.id,
    membershipId: membership.id,
    scopeType: membership.scopeType,
    scopeId: membership.tenantId ?? membership.supplierId ?? null,
    tenantId:
      membership.scopeType === "CUSTOMER" || membership.scopeType === "SUPPLIER"
        ? membership.tenantId
        : null,
    supplierId: membership.scopeType === "SUPPLIER" ? membership.supplierId : null,
    role: membership.role,
    capabilities,
    workerId: membership.workerId ?? null,
  };
}
