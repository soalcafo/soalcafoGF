import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forSupplier } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

const MODALITIES = ["IN_PERSON", "ONLINE_SELF_PACED", "BLENDED"] as const;

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

export default async function NewCoursePage({
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

  async function createCourse(formData: FormData) {
    "use server";
    const ctx = await requireAuth({ capability: "supplier.offer.manage" });
    if (!ctx.tenantId || !ctx.supplierId) throw new Error("No supplier context");

    const title = String(formData.get("title") ?? "").trim();
    const durationHours = Number(formData.get("durationHours") ?? 0);
    const rawMod = String(formData.get("modality") ?? "IN_PERSON");
    const modality = (MODALITIES as readonly string[]).includes(rawMod)
      ? (rawMod as (typeof MODALITIES)[number])
      : "IN_PERSON";
    const shortCode = String(formData.get("shortCode") ?? "").trim() || null;
    const objectives = String(formData.get("objectives") ?? "").trim() || null;
    const programmaticContents = String(formData.get("programmaticContents") ?? "").trim() || null;

    if (!title || !durationHours || durationHours <= 0) {
      redirect(`/${locale}/portal/trainings/new?error=required`);
    }

    const tenantId = ctx.tenantId;
    const supplierId = ctx.supplierId;
    const sourceId = `src_sup_${supplierId}`;
    let courseId = "";

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
      const course = await tx.training.create({
        data: {
          sourceId,
          tenantId,
          supplierId,
          title,
          slug: `${slugify(title)}-${Date.now().toString(36)}`,
          nominalMinutes: Math.round(durationHours * 60),
          modality,
          shortCode,
          objectives,
          programmaticContents,
          status: "PUBLISHED",
          requiresSession: true,
        },
      });
      courseId = course.id;
    });

    redirect(`/${locale}/portal/trainings/${courseId}`);
  }

  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/portal/trainings" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t("course.title")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("course.new")}</h1>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("course.form.errorRequired")}
        </p>
      ) : null}

      <form action={createCourse} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">{t("course.form.nameLabel")}</Label>
          <Input id="title" name="title" required autoFocus />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-1">
            <Label htmlFor="modality">{t("course.form.typeLabel")}</Label>
            <select id="modality" name="modality" defaultValue="IN_PERSON" className={selectClass}>
              {MODALITIES.map((m) => (
                <option key={m} value={m}>
                  {t(`modalities.${m}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="durationHours">{t("course.form.durationLabel")}</Label>
            <Input id="durationHours" name="durationHours" type="number" min="0" step="0.5" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shortCode">{t("course.form.codeLabel")}</Label>
            <Input id="shortCode" name="shortCode" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="objectives">{t("course.form.objectivesLabel")}</Label>
          <Textarea id="objectives" name="objectives" rows={3} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="programmaticContents">{t("course.form.contentsLabel")}</Label>
          <Textarea id="programmaticContents" name="programmaticContents" rows={4} />
        </div>

        <Button type="submit">{t("course.form.create")}</Button>
      </form>
    </div>
  );
}
