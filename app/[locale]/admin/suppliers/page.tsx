import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMap, createSupplierOrg } from "@/lib/db/admin-links";

export const dynamic = "force-dynamic";

export default async function AdminSuppliersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAuth({ capability: "supplier.manage" });
  const t = await getTranslations("vendor");

  const { orgs } = await getMap();

  async function doCreate(formData: FormData) {
    "use server";
    await requireAuth({ capability: "supplier.manage" });
    const name = String(formData.get("name") ?? "").trim();
    const contactEmail = String(formData.get("contactEmail") ?? "").trim() || null;
    if (name) {
      await createSupplierOrg({ name, contactEmail });
    }
    redirect(`/${locale}/admin/suppliers`);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t("map.title")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("suppliers.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t("suppliers.hint")}</p>
      </div>

      <Card>
        <CardContent className="py-4">
          <form action={doCreate} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("suppliers.nameLabel")}</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactEmail">{t("suppliers.emailLabel")}</Label>
              <Input id="contactEmail" name="contactEmail" type="email" />
            </div>
            <Button type="submit">{t("suppliers.add")}</Button>
          </form>
        </CardContent>
      </Card>

      {orgs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("suppliers.empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("suppliers.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("suppliers.email")}</TableHead>
                <TableHead className="text-right">{t("accounts.link")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.name}
                    <div className="text-xs text-muted-foreground sm:hidden">{o.contactEmail ?? "—"}</div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{o.contactEmail ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/admin/accounts/supplier/${o.id}`}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {t("accounts.link")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
