import type { ReactNode } from "react";
import { notFound } from "next/navigation";
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

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>;
}) {
  const { locale, courseId } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth({ capability: "supplier.offer.manage" });
  const t = await getTranslations("supplier");
  if (!ctx.tenantId || !ctx.supplierId) notFound();

  const course = await forSupplier(ctx.tenantId, ctx.supplierId, (tx) =>
    tx.training.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        modality: true,
        nominalMinutes: true,
        shortCode: true,
        objectives: true,
        programmaticContents: true,
        sessions: {
          where: { deletedAt: null },
          orderBy: { startsAt: "asc" },
          select: {
            id: true,
            name: true,
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
  );
  if (!course) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal/trainings" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t("course.title")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {course.title}
          {course.shortCode ? (
            <Badge variant="secondary" className="ml-2 font-mono">
              {course.shortCode}
            </Badge>
          ) : null}
        </h1>
        <div className="mt-1 text-sm text-muted-foreground">
          {t(`modalities.${course.modality}`)} · {formatHours(locale, course.nominalMinutes, t("course.hoursUnit"))}
        </div>
      </div>

      {course.objectives || course.programmaticContents ? (
        <Card>
          <CardContent className="space-y-4 py-4 text-sm">
            {course.objectives ? (
              <div>
                <div className="font-medium">{t("course.objectives")}</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{course.objectives}</p>
              </div>
            ) : null}
            {course.programmaticContents ? (
              <div>
                <div className="font-medium">{t("course.contents")}</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{course.programmaticContents}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{t("action.title")}</h2>
        <Button asChild>
          <Link href={`/portal/trainings/${course.id}/actions/new`}>{t("action.new")}</Link>
        </Button>
      </div>

      {course.sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("action.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {course.sessions.map((s) => {
            const st = STATUS[s.status];
            return (
              <Link key={s.id} href={`/portal/trainings/${course.id}/actions/${s.id}`} className="block">
                <Card className="overflow-hidden py-0 transition-colors hover:border-primary/50">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3 font-semibold">
                    <span>{s.name ?? course.title}</span>
                    <Badge variant={st.variant}>{t(`action.sessionStatus.${st.key}`)}</Badge>
                  </div>
                  <CardContent className="grid grid-cols-2 gap-4 py-4 text-center sm:grid-cols-3 lg:grid-cols-5">
                    <Field label={t("action.col.start")} value={formatDate(locale, s.startsAt)} />
                    <Field label={t("action.col.end")} value={formatDate(locale, s.endsAt)} />
                    <Field label={t("action.col.location")} value={s.atClientPremises ? t("action.atClient") : s.location ?? "—"} />
                    <Field label={t("action.col.schedule")} value={t(`action.schedule.${s.scheduleType}`)} />
                    <Field label={t("action.col.code")} value={s.sessionCode ?? course.shortCode ?? "—"} />
                  </CardContent>
                </Card>
              </Link>
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
