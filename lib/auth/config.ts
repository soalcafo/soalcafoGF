import type { NextAuthConfig } from "next-auth";

// EDGE-SAFE config. This is imported by middleware, so it must NOT pull in any
// Node-only modules (no Prisma, no argon2). The real providers, adapter, and
// DB-backed callbacks are added in lib/auth/index.ts (Node runtime only).
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [], // populated in lib/auth/index.ts
} satisfies NextAuthConfig;
