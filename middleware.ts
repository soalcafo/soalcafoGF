import createMiddleware from "next-intl/middleware";
import NextAuth from "next-auth";
import { routing } from "@/i18n/routing";
import { authConfig } from "@/lib/auth/config";

// Edge-safe auth instance (config only — no Prisma/argon2). Populates req.auth.
const { auth } = NextAuth(authConfig);
const intlMiddleware = createMiddleware(routing);

// Locale routing runs on every page request; the session is made available on
// req.auth. Per-route authorization is enforced server-side via requireAuth()
// (so it also covers Server Actions and direct API calls), not here.
export default auth((req) => intlMiddleware(req));

export const config = {
  // Run on everything except API routes, Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
