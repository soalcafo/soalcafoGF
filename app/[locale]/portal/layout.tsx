import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth, signOut } from "@/lib/auth";
import { requireAuth } from "@/lib/auth/require-auth";
import { scopeHome } from "@/lib/auth/scope";
import { switchActiveMembership } from "@/lib/auth/switch-membership";
import { AppShell } from "@/components/app/app-shell";

export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireAuth();
  // This area is for suppliers only.
  if (ctx.scopeType !== "SUPPLIER") {
    redirect(scopeHome(locale, ctx.scopeType, ctx.role));
  }

  const session = await auth();
  const t = await getTranslations("supplier");
  const c = await getTranslations("common");

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
    { href: "/portal", label: t("nav.dashboard") },
    { href: "/portal/trainings", label: t("nav.trainings") },
  ];

  return (
    <AppShell
      brand={c("appName")}
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
