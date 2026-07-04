import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { forSupplier } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatHours } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CoursesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth({ capability: "supplier.offer.manage" });
  const t = await getTranslations("supplier");

  const courses =
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
              modality: true,
              shortCode: true,
              _count: { select: { sessions: true } },
            },
          }),
        )
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("course.title")}</h1>
        <Button asChild>
          <Link href="/portal/trainings/new">{t("course.new")}</Link>
        </Button>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("course.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {courses.map((c) => (
            <Link key={c.id} href={`/portal/trainings/${c.id}`} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div>
                    <div className="font-semibold">
                      {c.title}
                      {c.shortCode ? (
                        <Badge variant="secondary" className="ml-2 font-mono">
                          {c.shortCode}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t(`modalities.${c.modality}`)} · {formatHours(locale, c.nominalMinutes, t("course.hoursUnit"))}
                    </div>
                  </div>
                  <Badge variant="outline">
                    {c._count.sessions} {t("course.colActions")}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
