"use client";

import { useRef } from "react";
import type { MembershipSummary } from "@/lib/auth/types";

/**
 * The "space" picker shown in the header when a user has more than one membership.
 * For a supplier serving several companies, this lists each company (one login, one space
 * per client). Changing the selection submits a server action that rewrites the active
 * membership and reloads the destination space.
 */
export function SpaceSwitcher({
  memberships,
  activeMembershipId,
  action,
  label,
}: {
  memberships: MembershipSummary[];
  activeMembershipId: string | null;
  action: (formData: FormData) => Promise<void>;
  label: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (memberships.length < 2) return null;

  return (
    <form action={action} ref={formRef}>
      <select
        name="membershipId"
        aria-label={label}
        defaultValue={activeMembershipId ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        className="max-w-[10rem] truncate rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {memberships.map((m) => (
          <option key={m.id} value={m.id}>
            {spaceLabel(m)}
          </option>
        ))}
      </select>
    </form>
  );
}

function spaceLabel(m: MembershipSummary): string {
  if (m.label) return m.label;
  if (m.scopeType === "FACILITY") return "Admin";
  return m.scopeId ?? m.id;
}
