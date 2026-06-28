import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const c = await getTranslations("common");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href="/" locale="pt-PT" className="hover:text-foreground">
          PT
        </Link>
        <span>·</span>
        <Link href="/" locale="en" className="hover:text-foreground">
          EN
        </Link>
      </div>
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-prose text-lg text-muted-foreground">{t("subtitle")}</p>
      <Link
        href="/login"
        className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {c("signIn")}
      </Link>
    </main>
  );
}
