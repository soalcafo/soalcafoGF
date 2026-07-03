import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { scopeHome } from "@/lib/auth/scope";

// Routes each signed-in user to the area for their active role.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await requireAuth();
  redirect(scopeHome(locale, ctx.scopeType, ctx.role));
}
