import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth, signOut } from "@/lib/auth";
import { requireAuth } from "@/lib/auth/require-auth";
import { scopeHome } from "@/lib/auth/scope";
import { switchActiveMembership } from "@/lib/auth/switch-membership";
import { getTenantBrand } from "@/lib/db/branding";
import { AppShell } from "@/components/app/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireAuth();
  // This area is for company HR users; send everyone else to their own home.
  if (ctx.scopeType !== "CUSTOMER" || ctx.role === "WORKER") {
    redirect(scopeHome(locale, ctx.scopeType, ctx.role));
  }

  const session = await auth();
  const t = await getTranslations("hr");
  const c = await getTranslations("common");
  // The company's own brand fills the header (their logo, or their name as a fallback).
  const brand = ctx.tenantId ? await getTenantBrand(ctx.tenantId) : null;

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}` });
  }

  async function doSwitch(formData: FormData) {
    "use server";
    const id = String(formData.get("membershipId") ?? "");
    if (id) await switchActiveMembership(id, locale);
  }

  const items = [
    { href: "/app", label: t("nav.dashboard") },
    { href: "/app/trainings", label: t("nav.trainings") },
    { href: "/app/suppliers", label: t("nav.suppliers") },
  ];

  return (
    <AppShell
      brand={brand?.name ?? c("appName")}
      logoUrl={brand?.logoUrl ?? null}
      navTitle={t("nav.title")}
      items={items}
      userLabel={session?.user?.name || session?.user?.email || ""}
      signOutLabel={c("signOut")}
      signOutAction={doSignOut}
      memberships={session?.memberships ?? []}
      activeMembershipId={session?.activeMembershipId ?? null}
      switchAction={doSwitch}
      switchLabel={c("switchSpace")}
    >
      {children}
    </AppShell>
  );
}
