import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forTenant } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "fornecedor"
  );
}

export default async function NewSupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  await requireAuth({ capability: "supplier.account.manage" });
  const t = await getTranslations("hr");

  async function createSupplier(formData: FormData) {
    "use server";
    const ctx = await requireAuth({ capability: "supplier.account.manage" });
    if (!ctx.tenantId) throw new Error("No tenant context");
    const name = String(formData.get("name") ?? "").trim();
    const contactEmail = String(formData.get("contactEmail") ?? "").trim() || null;
    if (!name) redirect(`/${locale}/app/suppliers/new?error=required`);
    const tenantId = ctx.tenantId;
    try {
      await forTenant(tenantId, (tx) =>
        tx.supplier.create({
          data: {
            tenantId,
            name,
            normalizedName: name.toLowerCase(),
            slug: `${slugify(name)}-${Date.now().toString(36)}`,
            contactEmail,
          },
        }),
      );
    } catch {
      redirect(`/${locale}/app/suppliers/new?error=exists`);
    }
    redirect(`/${locale}/app/suppliers`);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link href="/app/suppliers" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t("suppliers.title")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("suppliers.new")}</h1>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error === "exists" ? t("suppliers.errorExists") : t("suppliers.errorRequired")}
        </p>
      ) : null}

      <form action={createSupplier} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t("suppliers.name")}</Label>
          <Input id="name" name="name" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contactEmail">{t("suppliers.email")}</Label>
          <Input id="contactEmail" name="contactEmail" type="email" />
          <p className="text-xs text-muted-foreground">{t("suppliers.emailHint")}</p>
        </div>
        <Button type="submit">{t("suppliers.create")}</Button>
      </form>
    </div>
  );
}
