import "server-only";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, unstable_update } from "./index";
import { getMembershipById } from "@/lib/db/auth";
import { scopeHome } from "./scope";
import { ForbiddenError } from "./require-auth";

/**
 * Switch the active membership ("space") for the current user, then redirect to that
 * space's home. One login, many spaces: a supplier with memberships in several companies
 * moves between them here WITHOUT re-authenticating (no duplicate logins).
 *
 * SECURITY (two independent guards):
 *  1. The JWT `update` trigger only accepts a target that is already one of this user's own
 *     token memberships (built from the DB at sign-in) — see lib/auth/index.ts.
 *  2. Here we re-fetch the membership and assert it exists, is ACTIVE, and belongs to the
 *     current user — so a forged/stale id is rejected before the token is ever rewritten.
 */
export async function switchActiveMembership(membershipId: string, locale: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const membership = await getMembershipById(membershipId);
  if (!membership || membership.userId !== session.user.id || membership.status !== "ACTIVE") {
    throw new ForbiddenError();
  }

  // unstable_update's public type only exposes `user`, but the payload is forwarded verbatim
  // to the jwt() `update` trigger (lib/auth/index.ts), which reads activeMembershipId.
  await unstable_update({ activeMembershipId: membershipId } as unknown as Session);
  // A same-scope switch (e.g. supplier company A -> B) lands on the SAME URL (/portal); drop the
  // client Router Cache so the new space's data is refetched instead of showing the old company.
  revalidatePath("/", "layout");
  redirect(scopeHome(locale, membership.scopeType, membership.role));
}
