import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth, signOut } from "@/lib/auth";
import { requireAuth } from "@/lib/auth/require-auth";

// Depends on the signed-in user — never statically cache.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Redirects to /login if not authenticated.
  const ctx = await requireAuth();
  const session = await auth();
  const t = await getTranslations("dashboard");

  const displayName = session?.user?.name || session?.user?.email || "";

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}` });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <form action={doSignOut}>
          <button
            type="submit"
            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            {t("signOut")}
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-border p-6">
        <p className="text-lg">
          {t("welcome")}
          {displayName ? <>, <strong>{displayName}</strong></> : null}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("role")}: {ctx.role}
        </p>
      </div>

      <p className="text-muted-foreground">{t("comingSoon")}</p>
    </main>
  );
}
