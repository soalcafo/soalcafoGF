import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireAuth, ForbiddenError } from "@/lib/auth/require-auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  getCompanyAccounts,
  getSupplierAccounts,
  getCompanyName,
  getSupplierOrgName,
  resetPassword,
  resetEmail,
  disable2FA,
  setPrimaryCompanyAccount,
  setPrimarySupplierAccount,
  addCompanyAccount,
  addSupplierAccount,
} from "@/lib/db/admin-accounts";

export const dynamic = "force-dynamic";

const TYPES = ["company", "supplier"] as const;

export default async function AdminAccountsPage({
  params,
}: {
  params: Promise<{ locale: string; type: string; id: string }>;
}) {
  const { locale, type, id } = await params;
  setRequestLocale(locale);
  const ctx = await requireAuth();
  if (ctx.role !== "FACILITY_ADMIN") notFound();
  if (!(TYPES as readonly string[]).includes(type)) notFound();
  const isCompany = type === "company";
  const t = await getTranslations("vendor");

  const [entityName, accounts] = await Promise.all([
    isCompany ? getCompanyName(id) : getSupplierOrgName(id),
    isCompany ? getCompanyAccounts(id) : getSupplierAccounts(id),
  ]);
  if (entityName === null) notFound();

  const path = `/${locale}/admin/accounts/${type}/${id}`;

  async function doResetPassword(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (c.role !== "FACILITY_ADMIN") throw new ForbiddenError();
    const userId = String(formData.get("userId") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    if (userId && newPassword) {
      await resetPassword(userId, newPassword);
      revalidatePath(path);
    }
  }

  async function doResetEmail(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (c.role !== "FACILITY_ADMIN") throw new ForbiddenError();
    const userId = String(formData.get("userId") ?? "");
    const newEmail = String(formData.get("newEmail") ?? "");
    if (userId && newEmail) {
      await resetEmail(userId, newEmail);
      revalidatePath(path);
    }
  }

  async function doDisable2FA(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (c.role !== "FACILITY_ADMIN") throw new ForbiddenError();
    const userId = String(formData.get("userId") ?? "");
    if (userId) {
      await disable2FA(userId);
      revalidatePath(path);
    }
  }

  async function doSetMain(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (c.role !== "FACILITY_ADMIN") throw new ForbiddenError();
    const userId = String(formData.get("userId") ?? "");
    if (userId) {
      if (isCompany) await setPrimaryCompanyAccount(id, userId);
      else await setPrimarySupplierAccount(id, userId);
      revalidatePath(path);
    }
  }

  async function doAddAccount(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (c.role !== "FACILITY_ADMIN") throw new ForbiddenError();
    const email = String(formData.get("email") ?? "");
    const name = String(formData.get("name") ?? "");
    const password = String(formData.get("password") ?? "");
    const asPrimary = formData.get("asPrimary") === "on";
    if (email && password) {
      const input = { email, name, password, asPrimary };
      if (isCompany) await addCompanyAccount(id, input);
      else await addSupplierAccount(id, input);
      revalidatePath(path);
    }
  }

  const inputSm = "h-9";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={isCompany ? "/admin" : "/admin/suppliers"} className="text-sm text-muted-foreground hover:text-foreground">
          ← {isCompany ? t("map.title") : t("suppliers.title")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{entityName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("accounts.title")}</p>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("accounts.empty")}</p>
      ) : (
        <div className="space-y-4">
          {accounts.map((a) => (
            <Card key={a.userId}>
              <CardContent className="space-y-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.name || a.email}</span>
                  {a.isPrimary ? <Badge>{t("accounts.main")}</Badge> : <Badge variant="secondary">{t("accounts.sub")}</Badge>}
                  {!isCompany && a.spaces > 1 ? (
                    <Badge variant="outline">{t("accounts.spaces", { count: a.spaces })}</Badge>
                  ) : null}
                  <Badge variant={a.has2FA ? "default" : "outline"}>
                    {a.has2FA ? t("accounts.twoFaOn") : t("accounts.twoFaOff")}
                  </Badge>
                  {!a.isActive ? <Badge variant="destructive">{t("accounts.inactive")}</Badge> : null}
                </div>
                <div className="text-sm text-muted-foreground">{a.email}</div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <form action={doResetPassword} className="flex items-end gap-2">
                    <input type="hidden" name="userId" value={a.userId} />
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`pw-${a.userId}`} className="text-xs">
                        {t("accounts.newPassword")}
                      </Label>
                      <Input id={`pw-${a.userId}`} name="newPassword" type="text" minLength={8} className={inputSm} />
                    </div>
                    <Button type="submit" size="sm" variant="outline">
                      {t("accounts.resetPassword")}
                    </Button>
                  </form>

                  <form action={doResetEmail} className="flex items-end gap-2">
                    <input type="hidden" name="userId" value={a.userId} />
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`em-${a.userId}`} className="text-xs">
                        {t("accounts.newEmail")}
                      </Label>
                      <Input id={`em-${a.userId}`} name="newEmail" type="email" placeholder={a.email} className={inputSm} />
                    </div>
                    <Button type="submit" size="sm" variant="outline">
                      {t("accounts.resetEmail")}
                    </Button>
                  </form>
                </div>

                <div className="flex flex-wrap gap-2">
                  <form action={doDisable2FA}>
                    <input type="hidden" name="userId" value={a.userId} />
                    <Button type="submit" size="sm" variant="outline" disabled={!a.has2FA}>
                      {t("accounts.disable2fa")}
                    </Button>
                  </form>
                  {!a.isPrimary ? (
                    <form action={doSetMain}>
                      <input type="hidden" name="userId" value={a.userId} />
                      <Button type="submit" size="sm" variant="ghost">
                        {t("accounts.setMain")}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          <div className="mb-3 font-medium">{t("accounts.addTitle")}</div>
          <form action={doAddAccount} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("accounts.nameLabel")}</Label>
              <Input id="name" name="name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("accounts.emailLabel")}</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("accounts.passwordLabel")}</Label>
              <Input id="password" name="password" type="text" minLength={8} required />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="asPrimary" className="h-4 w-4 rounded border-input" />
                {t("accounts.makeMain")}
              </label>
            </div>
            <div>
              <Button type="submit">{t("accounts.add")}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
