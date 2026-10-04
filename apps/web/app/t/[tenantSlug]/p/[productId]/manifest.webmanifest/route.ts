import {
  isWebAppTenantSlug,
  liveWebAppManifest,
  WEB_APP_PRODUCT_ID,
} from "@/src/platform/web-app-manifest";

// The install manifest for the live overlay (ADR-0019). Public by design: it
// holds a tenant slug and static text only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string; productId: string }> },
): Promise<Response> {
  const { tenantSlug, productId } = await params;
  if (productId !== WEB_APP_PRODUCT_ID || !isWebAppTenantSlug(tenantSlug))
    return new Response(null, { status: 404 });
  return new Response(JSON.stringify(liveWebAppManifest(tenantSlug)), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "public, max-age=3600",
    },
  });
}
