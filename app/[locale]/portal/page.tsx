import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forSupplier } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SupplierDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth();
  const t = await getTranslations("supplier");

  const [trainings, workers] =
    ctx.tenantId && ctx.supplierId
      ? await forSupplier(ctx.tenantId, ctx.supplierId, async (tx) => [
          await tx.training.count({ where: { deletedAt: null } }),
          await tx.worker.count(), // RLS restricts to this supplier's enrolled workers only
        ])
      : [0, 0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("dashboard.trainings")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{trainings}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("dashboard.enrolledWorkers")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{workers}</CardContent>
        </Card>
      </div>
      <p className="max-w-prose text-muted-foreground">{t("dashboard.hint")}</p>
    </div>
  );
}
