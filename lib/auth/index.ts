import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { z } from "zod";
import { authConfig } from "./config";
import { authAdapter, getActiveMembershipsForUser, getUserByEmail } from "@/lib/db/auth";
import type { MembershipSummary } from "./types";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: authAdapter,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await getUserByEmail(email);
        if (!user || !user.isActive || !user.passwordHash) return null;
        // argon2 is Node-only; imported lazily so it never reaches the edge bundle.
        const argon2 = await import("argon2");
        const ok = await argon2.verify(user.passwordHash, password);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    // Magic-link login + invitation onboarding (enabled once AUTH_RESEND_KEY is set).
    ...(process.env.AUTH_RESEND_KEY
      ? [Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.EMAIL_FROM })]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Runs with DB access only at sign-in (when `user` is present). On normal
      // requests the token already carries these claims and we just pass it through.
      if (user?.id) {
        token.userId = user.id;
        const memberships = await getActiveMembershipsForUser(user.id);
        const summaries: MembershipSummary[] = memberships.map((m) => ({
          id: m.id,
          scopeType: m.scopeType,
          scopeId: m.tenantId ?? m.supplierId ?? null,
          role: m.role,
          label: m.tenant?.name ?? null,
        }));
        token.memberships = summaries;
        token.activeMembershipId = summaries[0]?.id ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      session.activeMembershipId = (token.activeMembershipId as string | null | undefined) ?? null;
      session.memberships = (token.memberships as MembershipSummary[] | undefined) ?? [];
      return session;
    },
  },
});
