import "server-only";
import { prisma } from "./client";

// Company (tenant) branding. Tenant is NOT RLS-scoped, so these run on the raw client and a
// logo can be read by anyone who legitimately renders that company's header/cards (and served
// from a browser-cacheable route). Logos are brand assets, not secrets.

export async function getTenantBrand(tenantId: string): Promise<{ name: string; logoUrl: string | null } | null> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, logoUrl: true } });
  return t ? { name: t.name, logoUrl: t.logoUrl } : null;
}

export async function getTenantLogo(tenantId: string): Promise<{ data: Uint8Array; mime: string } | null> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { logoData: true, logoMime: true } });
  if (!t?.logoData || !t.logoMime) return null;
  return { data: t.logoData, mime: t.logoMime };
}

/** Store or clear a company logo. Passing null data clears it. The stored URL carries a
 *  version query so a re-upload busts the browser/CDN cache even though the path is stable. */
export async function setTenantLogo(tenantId: string, data: Uint8Array<ArrayBuffer> | null, mime: string | null) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      logoData: data,
      logoMime: data ? mime : null,
      logoUrl: data ? `/api/branding/company/${tenantId}?v=${Date.now()}` : null,
    },
  });
}
