import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forTenant } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth({ capability: "supplier.account.manage" });
  const t = await getTranslations("hr");

  const suppliers = ctx.tenantId
    ? await forTenant(ctx.tenantId, (tx) =>
        tx.supplier.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          take: 100,
          select: { id: true, name: true, contactEmail: true, status: true, isAtec: true },
        }),
      )
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("suppliers.title")}</h1>
        <Button asChild>
          <Link href="/app/suppliers/new">{t("suppliers.new")}</Link>
        </Button>
      </div>

      {suppliers.length === 0 ? (
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
                <TableHead>{t("suppliers.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.name}
                    {s.isAtec ? (
                      <Badge variant="secondary" className="ml-2">
                        ATEC
                      </Badge>
                    ) : null}
                    <div className="text-xs text-muted-foreground sm:hidden">{s.contactEmail ?? "—"}</div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {s.contactEmail ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "ACTIVE" ? "default" : "secondary"}>{s.status}</Badge>
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
