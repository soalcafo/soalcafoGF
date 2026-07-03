import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAuth();
  const t = await getTranslations("vendor");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
      <p className="max-w-prose text-muted-foreground">{t("dashboard.hint")}</p>
    </div>
  );
}
