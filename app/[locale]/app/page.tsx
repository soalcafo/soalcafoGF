import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forTenant } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function HrDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth();
  const t = await getTranslations("hr");

  const [suppliers, workers] = ctx.tenantId
    ? await forTenant(ctx.tenantId, async (tx) => [
        await tx.supplier.count({ where: { deletedAt: null } }),
        await tx.worker.count({ where: { deletedAt: null } }),
      ])
    : [0, 0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("nav.suppliers")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{suppliers}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("nav.workers")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{workers}</CardContent>
        </Card>
      </div>
      <p className="text-muted-foreground">{t("dashboard.hint")}</p>
      <Link
        href="/app/suppliers"
        className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {t("suppliers.manage")}
      </Link>
    </div>
  );
}
