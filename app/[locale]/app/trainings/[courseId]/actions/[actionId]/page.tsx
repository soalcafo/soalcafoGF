import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forTenant } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { SessionFilesSection } from "@/components/app/session-files";
import { formatDate, formatHours } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HrActionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; courseId: string; actionId: string }>;
}) {
  const { locale, courseId, actionId } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth();
  const t = await getTranslations("supplier");
  if (!ctx.tenantId) notFound();

  const action = await forTenant(ctx.tenantId, (tx) =>
    tx.trainingSession.findUnique({
      where: { id: actionId },
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        location: true,
        atClientPremises: true,
        scheduleType: true,
        sessionCode: true,
        nominalMinutes: true,
        objectives: true,
        programmaticContents: true,
        training: { select: { title: true, nominalMinutes: true, objectives: true, programmaticContents: true } },
        modules: { orderBy: { orderIndex: "asc" }, select: { id: true, name: true, nominalMinutes: true, programmaticContents: true } },
      },
    }),
  );
  if (!action) notFound();

  async function addModule(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (!c.tenantId) throw new Error("No tenant context");
    const name = String(formData.get("name") ?? "").trim();
    const durationHours = Number(formData.get("durationHours") ?? 0);
    const contents = String(formData.get("contents") ?? "").trim() || null;
    if (name) {
      await forTenant(c.tenantId, (tx) =>
        tx.trainingModule.create({
          data: {
            sessionId: actionId,
            name,
            nominalMinutes: durationHours > 0 ? Math.round(durationHours * 60) : 0,
            programmaticContents: contents,
          },
        }),
      );
    }
    redirect(`/${locale}/app/trainings/${courseId}/actions/${actionId}`);
  }

  const objectives = action.objectives ?? action.training.objectives;
  const contents = action.programmaticContents ?? action.training.programmaticContents;
  const duration = action.nominalMinutes ?? action.training.nominalMinutes;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/trainings/${courseId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {action.training.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{action.name ?? action.training.title}</h1>
        <div className="mt-1 text-sm text-muted-foreground">
          {formatDate(locale, action.startsAt)} – {formatDate(locale, action.endsAt)} · {formatHours(locale, duration, t("action.hoursUnit"))}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 py-4 text-sm sm:grid-cols-2">
          <Field label={t("action.col.location")} value={action.atClientPremises ? t("action.atClient") : action.location ?? "—"} />
          <Field label={t("action.col.schedule")} value={t(`action.schedule.${action.scheduleType}`)} />
          <Field label={t("action.col.code")} value={action.sessionCode ?? "—"} />
        </CardContent>
      </Card>

      {objectives || contents ? (
        <Card>
          <CardContent className="space-y-4 py-4 text-sm">
            {objectives ? (
              <div>
                <div className="font-medium">{t("action.form.objectivesLabel")}</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{objectives}</p>
              </div>
            ) : null}
            {contents ? (
              <div>
                <div className="font-medium">{t("action.form.contentsLabel")}</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{contents}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Módulos (opcional) */}
      <h2 className="text-lg font-semibold">{t("module.title")}</h2>
      {action.modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("module.empty")}</p>
      ) : (
        <div className="space-y-2">
          {action.modules.map((m, i) => (
            <Card key={m.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium">
                    {i + 1}. {m.name}
                  </span>
                  <span className="text-sm text-muted-foreground">{formatHours(locale, m.nominalMinutes, t("module.hoursUnit"))}</span>
                </div>
                {m.programmaticContents ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{m.programmaticContents}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          <form action={addModule} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("module.form.nameLabel")}</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="durationHours">{t("module.form.durationLabel")}</Label>
              <Input id="durationHours" name="durationHours" type="number" min="0" step="0.5" className="sm:w-28" />
            </div>
            <Button type="submit">{t("module.form.create")}</Button>
            <Textarea
              id="contents"
              name="contents"
              rows={2}
              placeholder={t("module.form.contentsLabel")}
              className="sm:col-span-3"
            />
          </form>
        </CardContent>
      </Card>

      {/* DTP + Certificados */}
      <SessionFilesSection
        sessionId={actionId}
        pagePath={`/${locale}/app/trainings/${courseId}/actions/${actionId}`}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
