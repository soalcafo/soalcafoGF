import { getTenantLogo } from "@/lib/db/branding";

// Serves a company's logo bytes. The stored logoUrl carries a ?v= cache-buster, so this
// path is safe to cache aggressively — a re-upload changes the URL. Logos are brand assets.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const logo = await getTenantLogo(id);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "public, max-age=86400, immutable",
      // Rendered via <img>, but a logo opened at its raw URL must not execute (e.g. a scripted SVG).
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
