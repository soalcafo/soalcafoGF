import { getTranslations, setRequestLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/require-auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMap, linkCompanyToSupplierOrg, unlinkCompanyFromSupplierOrg } from "@/lib/db/admin-links";
import { setTenantLogo } from "@/lib/db/branding";

export const dynamic = "force-dynamic";

export default async function AdminMapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAuth({ capability: "supplier.manage" });
  const t = await getTranslations("vendor");

  const { companies, orgs, links } = await getMap();

  async function doLink(formData: FormData) {
    "use server";
    await requireAuth({ capability: "supplier.manage" });
    const tenantId = String(formData.get("tenantId") ?? "");
    const orgId = String(formData.get("orgId") ?? "");
    if (tenantId && orgId) {
      await linkCompanyToSupplierOrg(tenantId, orgId);
      revalidatePath(`/${locale}/admin`);
    }
  }

  async function doUnlink(formData: FormData) {
    "use server";
    await requireAuth({ capability: "supplier.manage" });
    const tenantId = String(formData.get("tenantId") ?? "");
    const orgId = String(formData.get("orgId") ?? "");
    if (tenantId && orgId) {
      await unlinkCompanyFromSupplierOrg(tenantId, orgId);
      revalidatePath(`/${locale}/admin`);
    }
  }

  async function doUploadLogo(formData: FormData) {
    "use server";
    await requireAuth({ capability: "supplier.manage" });
    const tenantId = String(formData.get("tenantId") ?? "");
    const file = formData.get("logo");
    if (tenantId && file instanceof File && file.size > 0) {
      if (!file.type.startsWith("image/")) throw new Error("Logo must be an image");
      if (file.size > 512 * 1024) throw new Error("Logo must be 512KB or smaller");
      const buf = new Uint8Array(await file.arrayBuffer());
      await setTenantLogo(tenantId, buf, file.type);
      revalidatePath(`/${locale}/admin`);
    }
  }

  async function doRemoveLogo(formData: FormData) {
    "use server";
    await requireAuth({ capability: "supplier.manage" });
    const tenantId = String(formData.get("tenantId") ?? "");
    if (tenantId) {
      await setTenantLogo(tenantId, null, null);
      revalidatePath(`/${locale}/admin`);
    }
  }

  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const selectClass =
    "rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("map.title")}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t("map.hint")}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/suppliers">{t("map.manageSuppliers")}</Link>
        </Button>
      </div>

      {companies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("map.noCompanies")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {companies.map((c) => {
            const linkedOrgIds = links.filter((l) => l.tenantId === c.id).map((l) => l.orgId);
            const linkedSet = new Set(linkedOrgIds);
            const unlinked = orgs.filter((o) => !linkedSet.has(o.id));
            return (
              <Card key={c.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{c.name}</span>
                    <Link
                      href={`/admin/accounts/company/${c.id}`}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {t("accounts.link")}
                    </Link>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-2">
                    {c.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logoUrl} alt={c.name} className="h-8 w-auto max-w-[120px] object-contain" />
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("map.noLogo")}</span>
                    )}
                    <form action={doUploadLogo} className="flex items-center gap-1.5">
                      <input type="hidden" name="tenantId" value={c.id} />
                      <input
                        type="file"
                        name="logo"
                        accept="image/*"
                        required
                        className="max-w-[150px] text-xs file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs"
                      />
                      <Button type="submit" size="sm" variant="outline">
                        {t("map.uploadLogo")}
                      </Button>
                    </form>
                    {c.logoUrl ? (
                      <form action={doRemoveLogo}>
                        <input type="hidden" name="tenantId" value={c.id} />
                        <button type="submit" className="text-xs text-muted-foreground hover:text-destructive">
                          {t("map.removeLogo")}
                        </button>
                      </form>
                    ) : null}
                  </div>

                  {linkedOrgIds.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("map.noLinks")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {linkedOrgIds.map((orgId) => (
                        <span
                          key={orgId}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium"
                        >
                          {orgById.get(orgId)?.name ?? orgId}
                          <form action={doUnlink} className="flex">
                            <input type="hidden" name="tenantId" value={c.id} />
                            <input type="hidden" name="orgId" value={orgId} />
                            <button
                              type="submit"
                              aria-label={t("map.unlink")}
                              title={t("map.unlink")}
                              className="leading-none text-muted-foreground hover:text-destructive"
                            >
                              ×
                            </button>
                          </form>
                        </span>
                      ))}
                    </div>
                  )}

                  {unlinked.length > 0 ? (
                    <form action={doLink} className="flex items-center gap-2 pt-1">
                      <input type="hidden" name="tenantId" value={c.id} />
                      <select name="orgId" defaultValue={unlinked[0]?.id} className={selectClass}>
                        {unlinked.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm">
                        {t("map.link")}
                      </Button>
                    </form>
                  ) : orgs.length > 0 ? (
                    <p className="text-xs text-muted-foreground">{t("map.allLinked")}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {orgs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("map.noOrgs")}{" "}
          <Link href="/admin/suppliers" className="text-primary underline">
            {t("map.manageSuppliers")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
