import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forTenant } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

const SCHEDULE_TYPES = ["WORKING_HOURS", "AFTER_HOURS", "MIXED"] as const;

export default async function NewHrActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, courseId } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const ctx = await requireAuth();
  const t = await getTranslations("supplier");
  if (!ctx.tenantId) notFound();

  const course = await forTenant(ctx.tenantId, (tx) =>
    tx.training.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, objectives: true, programmaticContents: true, nominalMinutes: true, shortCode: true },
    }),
  );
  if (!course) notFound();

  async function createAction(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (!c.tenantId) throw new Error("No tenant context");
    const tenantId = c.tenantId;
    const name = String(formData.get("name") ?? "").trim() || null;
    const startStr = String(formData.get("startsAt") ?? "");
    const endStr = String(formData.get("endsAt") ?? "");
    const location = String(formData.get("location") ?? "").trim() || null;
    const atClientPremises = formData.get("atClientPremises") === "on";
    const rawSchedule = String(formData.get("scheduleType") ?? "WORKING_HOURS");
    const scheduleType = (SCHEDULE_TYPES as readonly string[]).includes(rawSchedule)
      ? (rawSchedule as (typeof SCHEDULE_TYPES)[number])
      : "WORKING_HOURS";
    const durationHours = Number(formData.get("durationHours") ?? 0);
    const sessionCode = String(formData.get("sessionCode") ?? "").trim() || null;
    const objectives = String(formData.get("objectives") ?? "").trim() || null;
    const programmaticContents = String(formData.get("programmaticContents") ?? "").trim() || null;

    if (!startStr || !endStr) {
      redirect(`/${locale}/app/trainings/${courseId}/actions/new?error=required`);
    }

    // supplierId is copied from the parent course by the DB trigger (enforce_session_supplier).
    await forTenant(tenantId, (tx) =>
      tx.trainingSession.create({
        data: {
          trainingId: courseId,
          name,
          startsAt: new Date(`${startStr}T09:00:00`),
          endsAt: new Date(`${endStr}T18:00:00`),
          location,
          atClientPremises,
          scheduleType,
          sessionCode,
          nominalMinutes: durationHours > 0 ? Math.round(durationHours * 60) : null,
          objectives,
          programmaticContents,
          status: "SCHEDULED",
        },
      }),
    );

    redirect(`/${locale}/app/trainings/${courseId}`);
  }

  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href={`/app/trainings/${courseId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {course.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("action.new")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("action.prefillHint")}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("action.form.errorRequired")}
        </p>
      ) : null}

      <form action={createAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t("action.form.nameLabel")}</Label>
          <Input id="name" name="name" defaultValue={course.title} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="startsAt">{t("action.form.startLabel")}</Label>
            <Input id="startsAt" name="startsAt" type="date" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endsAt">{t("action.form.endLabel")}</Label>
            <Input id="endsAt" name="endsAt" type="date" required />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="durationHours">{t("action.form.durationLabel")}</Label>
            <Input
              id="durationHours"
              name="durationHours"
              type="number"
              min="0"
              step="0.5"
              defaultValue={course.nominalMinutes / 60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sessionCode">{t("action.form.codeLabel")}</Label>
            <Input id="sessionCode" name="sessionCode" defaultValue={course.shortCode ?? ""} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location">{t("action.form.locationLabel")}</Label>
          <Input id="location" name="location" />
        </div>

        <div className="flex items-center gap-2">
          <input id="atClientPremises" name="atClientPremises" type="checkbox" className="h-4 w-4 rounded border-input" />
          <Label htmlFor="atClientPremises" className="font-normal">
            {t("action.form.atClientLabel")}
          </Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="scheduleType">{t("action.form.scheduleLabel")}</Label>
          <select id="scheduleType" name="scheduleType" defaultValue="WORKING_HOURS" className={selectClass}>
            {SCHEDULE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`action.schedule.${s}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="objectives">{t("action.form.objectivesLabel")}</Label>
          <Textarea id="objectives" name="objectives" rows={3} defaultValue={course.objectives ?? ""} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="programmaticContents">{t("action.form.contentsLabel")}</Label>
          <Textarea id="programmaticContents" name="programmaticContents" rows={4} defaultValue={course.programmaticContents ?? ""} />
        </div>

        <Button type="submit">{t("action.form.create")}</Button>
      </form>
    </div>
  );
}
