import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forSupplier } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatHours } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS = {
  SCHEDULED: { key: "scheduled", variant: "secondary" },
  OPEN_FOR_ENROLLMENT: { key: "scheduled", variant: "secondary" },
  FULL: { key: "scheduled", variant: "secondary" },
  IN_PROGRESS: { key: "inProgress", variant: "default" },
  COMPLETED: { key: "completed", variant: "default" },
  CANCELLED: { key: "cancelled", variant: "destructive" },
} as const;

export default async function SupplierTrainingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth({ capability: "supplier.offer.manage" });
  const t = await getTranslations("supplier");

  const trainings =
    ctx.tenantId && ctx.supplierId
      ? await forSupplier(ctx.tenantId, ctx.supplierId, (tx) =>
          tx.training.findMany({
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              title: true,
              nominalMinutes: true,
              shortCode: true,
              sessions: {
                orderBy: { startsAt: "asc" },
                take: 1,
                select: {
                  startsAt: true,
                  endsAt: true,
                  location: true,
                  atClientPremises: true,
                  scheduleType: true,
                  sessionCode: true,
                  status: true,
                },
              },
            },
          }),
        )
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("trainings.title")}</h1>
        <Button asChild>
          <Link href="/portal/trainings/new">{t("trainings.new")}</Link>
        </Button>
      </div>

      {trainings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("trainings.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {trainings.map((tr) => {
            const s = tr.sessions[0];
            const st = s ? STATUS[s.status] : STATUS.SCHEDULED;
            return (
              <Card key={tr.id} className="overflow-hidden py-0">
                <div className="border-b border-border px-4 py-3 font-semibold">{tr.title}</div>
                <CardContent className="grid grid-cols-2 gap-4 py-4 text-center sm:grid-cols-4 lg:grid-cols-7">
                  <Field label={t("trainings.col.duration")} value={formatHours(locale, tr.nominalMinutes, t("trainings.hoursUnit"))} />
                  <Field label={t("trainings.col.location")} value={s?.atClientPremises ? t("trainings.atClient") : s?.location ?? "—"} />
                  <Field label={t("trainings.col.start")} value={s ? formatDate(locale, s.startsAt) : "—"} />
                  <Field label={t("trainings.col.end")} value={s ? formatDate(locale, s.endsAt) : "—"} />
                  <Field label={t("trainings.col.schedule")} value={s ? t(`trainings.schedule.${s.scheduleType}`) : "—"} />
                  <Field label={t("trainings.col.code")} value={s?.sessionCode ?? tr.shortCode ?? "—"} />
                  <Field
                    label={t("trainings.col.status")}
                    value={<Badge variant={st.variant}>{t(`trainings.sessionStatus.${st.key}`)}</Badge>}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
