import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forSupplier } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const SCHEDULE_TYPES = ["WORKING_HOURS", "AFTER_HOURS", "MIXED"] as const;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "formacao"
  );
}

export default async function NewTrainingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  await requireAuth({ capability: "supplier.offer.manage" });
  const t = await getTranslations("supplier");

  async function createTraining(formData: FormData) {
    "use server";
    const ctx = await requireAuth({ capability: "supplier.offer.manage" });
    if (!ctx.tenantId || !ctx.supplierId) throw new Error("No supplier context");

    const title = String(formData.get("title") ?? "").trim();
    const durationHours = Number(formData.get("durationHours") ?? 0);
    const shortCode = String(formData.get("shortCode") ?? "").trim() || null;
    const location = String(formData.get("location") ?? "").trim() || null;
    const atClientPremises = formData.get("atClientPremises") === "on";
    const rawSchedule = String(formData.get("scheduleType") ?? "WORKING_HOURS");
    const scheduleType = (SCHEDULE_TYPES as readonly string[]).includes(rawSchedule)
      ? (rawSchedule as (typeof SCHEDULE_TYPES)[number])
      : "WORKING_HOURS";
    const startStr = String(formData.get("startsAt") ?? "");
    const endStr = String(formData.get("endsAt") ?? "");

    if (!title || !durationHours || durationHours <= 0 || !startStr || !endStr) {
      redirect(`/${locale}/portal/trainings/new?error=required`);
    }

    const tenantId = ctx.tenantId;
    const supplierId = ctx.supplierId;
    const sourceId = `src_sup_${supplierId}`;
    const startsAt = new Date(`${startStr}T09:00:00`);
    const endsAt = new Date(`${endStr}T18:00:00`);

    await forSupplier(tenantId, supplierId, async (tx) => {
      await tx.trainingSource.upsert({
        where: { id: sourceId },
        update: {},
        create: {
          id: sourceId,
          sourceType: "SUPPLIER",
          kind: "SUPPLIER",
          name: "Formações do fornecedor",
          normalizedName: "formacoes do fornecedor",
          slug: sourceId.replace(/_/g, "-"),
          isTenantPrivate: true,
          tenantId,
          supplierId,
        },
      });
      const training = await tx.training.create({
        data: {
          sourceId,
          tenantId,
          supplierId,
          title,
          slug: `${slugify(title)}-${Date.now().toString(36)}`,
          nominalMinutes: Math.round(durationHours * 60),
          shortCode,
          status: "PUBLISHED",
          requiresSession: true,
        },
      });
      await tx.trainingSession.create({
        data: {
          trainingId: training.id,
          startsAt,
          endsAt,
          location,
          atClientPremises,
          scheduleType,
          sessionCode: shortCode,
          status: "SCHEDULED",
        },
      });
    });

    redirect(`/${locale}/portal/trainings`);
  }

  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/portal/trainings" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t("trainings.title")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("trainings.new")}</h1>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("trainings.form.errorRequired")}
        </p>
      ) : null}

      <form action={createTraining} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">{t("trainings.form.titleLabel")}</Label>
          <Input id="title" name="title" required autoFocus />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="durationHours">{t("trainings.form.durationLabel")}</Label>
            <Input id="durationHours" name="durationHours" type="number" min="0" step="0.5" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shortCode">{t("trainings.form.codeLabel")}</Label>
            <Input id="shortCode" name="shortCode" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="startsAt">{t("trainings.form.startLabel")}</Label>
            <Input id="startsAt" name="startsAt" type="date" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endsAt">{t("trainings.form.endLabel")}</Label>
            <Input id="endsAt" name="endsAt" type="date" required />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location">{t("trainings.form.locationLabel")}</Label>
          <Input id="location" name="location" />
        </div>

        <div className="flex items-center gap-2">
          <input id="atClientPremises" name="atClientPremises" type="checkbox" className="h-4 w-4 rounded border-input" />
          <Label htmlFor="atClientPremises" className="font-normal">
            {t("trainings.form.atClientLabel")}
          </Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="scheduleType">{t("trainings.form.scheduleLabel")}</Label>
          <select id="scheduleType" name="scheduleType" defaultValue="WORKING_HOURS" className={selectClass}>
            {SCHEDULE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`trainings.schedule.${s}`)}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit">{t("trainings.form.create")}</Button>
      </form>
    </div>
  );
}
