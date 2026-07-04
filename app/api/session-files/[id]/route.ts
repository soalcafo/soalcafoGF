import { requireAuth } from "@/lib/auth/require-auth";
import { readSessionFile } from "@/lib/db/session-files";

// Auth'd, RLS-scoped download for a DTP/Certificate. requireAuth() establishes WHO is asking;
// readSessionFile runs in that caller's RLS scope, so a file the caller may not see returns
// null -> 404. Never cached (private files).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuth();
  const file = await readSessionFile(ctx, id);
  if (!file) return new Response("Not found", { status: 404 });
  // Force a DOWNLOAD (never inline render) with nosniff: user-uploaded bytes must not execute
  // as HTML/SVG in our origin when a company opens a supplier's file (stored-XSS prevention).
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
