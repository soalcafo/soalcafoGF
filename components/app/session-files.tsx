import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  listSessionFiles,
  createSessionFile,
  deleteSessionFile,
  canAccessSessionFiles,
  type SessionFileMeta,
} from "@/lib/db/session-files";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const fileInputClass =
  "max-w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs";

// Belt-and-suspenders with the download route's attachment+nosniff: reject types that browsers
// would execute if ever rendered in-origin.
const BLOCKED_MIME = new Set(["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml"]);
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * DTP + Certificate area for an Ação. Server component: fetches (RLS-scoped) and renders the
 * two file lists plus upload/delete. Reused by the supplier portal and the HR app; access
 * control is entirely in the DB (see lib/db/session-files.ts + security.sql), not here.
 */
export async function SessionFilesSection({ sessionId, pagePath }: { sessionId: string; pagePath: string }) {
  const ctx = await requireAuth();
  // Workers (and any non-HR/supplier/facility role) never see the files section.
  if (!canAccessSessionFiles(ctx)) return null;
  const t = await getTranslations("supplier");
  const files = await listSessionFiles(ctx, sessionId);
  const dtp = files.filter((f) => f.kind === "DTP");
  const certs = files.filter((f) => f.kind === "CERTIFICATE");

  async function upload(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (!canAccessSessionFiles(c)) return;
    const file = formData.get("file");
    const rawKind = String(formData.get("kind") ?? "DTP");
    const kind = rawKind === "CERTIFICATE" ? "CERTIFICATE" : "DTP";
    const label = String(formData.get("label") ?? "").trim() || null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) throw new Error("File too large (max 10MB)");
      // Normalize before the blocklist (params/case are attacker-controlled). NOTE: the real
      // XSS defense is the download route's attachment+nosniff — this blocklist is secondary.
      const mimeType = (file.type || "application/octet-stream").split(";")[0]!.trim().toLowerCase();
      if (BLOCKED_MIME.has(mimeType)) throw new Error("Unsupported file type");
      const data = new Uint8Array(await file.arrayBuffer());
      // A global-catalog session (Training.tenantId NULL) makes the lineage trigger reject the
      // write; degrade gracefully rather than 500 (unreachable in this app — all courses are
      // tenant-scoped — but defensive).
      try {
        await createSessionFile(c, { sessionId, kind, fileName: file.name, mimeType, data, label });
      } catch {
        return;
      }
      revalidatePath(pagePath);
    }
  }

  async function remove(formData: FormData) {
    "use server";
    const c = await requireAuth();
    if (!canAccessSessionFiles(c)) return;
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteSessionFile(c, id);
      revalidatePath(pagePath);
    }
  }

  function fileList(items: SessionFileMeta[], useLabel: boolean) {
    return (
      <ul className="space-y-1.5">
        {items.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
            <a
              href={`/api/session-files/${f.id}`}
              target="_blank"
              rel="noreferrer"
              className="truncate text-primary hover:underline"
            >
              {(useLabel && f.label) || f.fileName}
            </a>
            <span className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
              {fmtSize(f.sizeBytes)}
              <form action={remove} className="flex">
                <input type="hidden" name="id" value={f.id} />
                <button type="submit" className="leading-none hover:text-destructive" aria-label={t("module.delete")}>
                  ×
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="font-medium">{t("module.dtp")}</div>
          {dtp.length === 0 ? <p className="text-sm text-muted-foreground">{t("module.noFiles")}</p> : fileList(dtp, false)}
          <form action={upload} className="space-y-2">
            <input type="hidden" name="kind" value="DTP" />
            <input type="file" name="file" required className={fileInputClass} />
            <Button type="submit" size="sm" variant="outline">
              {t("module.upload")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="font-medium">{t("module.certificates")}</div>
          {certs.length === 0 ? <p className="text-sm text-muted-foreground">{t("module.noFiles")}</p> : fileList(certs, true)}
          <form action={upload} className="space-y-2">
            <input type="hidden" name="kind" value="CERTIFICATE" />
            <Input name="label" placeholder={t("module.participant")} className="h-8 text-sm" />
            <input type="file" name="file" required className={fileInputClass} />
            <Button type="submit" size="sm" variant="outline">
              {t("module.upload")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
