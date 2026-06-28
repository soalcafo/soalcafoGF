import type { DefaultSession } from "next-auth";
import type { MembershipSummary } from "@/lib/auth/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      locale?: string;
    } & DefaultSession["user"];
    activeMembershipId: string | null;
    memberships: MembershipSummary[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    activeMembershipId?: string | null;
    memberships?: MembershipSummary[];
  }
}
