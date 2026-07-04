import { requireAuth } from "@/lib/auth/require-auth";
import { readSessionFile, canAccessSessionFiles } from "@/lib/db/session-files";

// Auth'd, RLS-scoped download for a DTP/Certificate. requireAuth() establishes WHO is asking;
// canAccessSessionFiles() denies roles that must not see files (notably WORKER — a directly
// reachable /api route must not rely on the UI hiding it); readSessionFile then runs in the
// caller's RLS scope, so a file the caller may not see returns null -> 404. Never cached.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuth();
  if (!canAccessSessionFiles(ctx)) return new Response("Not found", { status: 404 });
  const file = await readSessionFile(ctx, id);
  if (!file) return new Response("Not found", { status: 404 });
  // Force a DOWNLOAD (never inline render) with nosniff: user-uploaded bytes must not execute
  // as HTML/SVG in our origin when a company opens a supplier's file (stored-XSS prevention).
  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
