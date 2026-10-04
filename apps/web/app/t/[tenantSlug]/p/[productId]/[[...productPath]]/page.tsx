import type { Metadata } from "next";
import { notFound } from "next/navigation";
import React from "react";

import { resolvePlatformContext } from "@/src/platform/context";
import { getProductRegistry } from "@/src/platform/registry";
import {
  isWebAppTenantSlug,
  WEB_APP_PRODUCT_ID,
} from "@/src/platform/web-app-manifest";

// Lets a browser offer "Install app" for Interview Studio's live overlay
// (ADR-0019). Other products declare nothing.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; productId: string }>;
}): Promise<Metadata> {
  const { tenantSlug, productId } = await params;
  if (productId !== WEB_APP_PRODUCT_ID || !isWebAppTenantSlug(tenantSlug))
    return {};
  return {
    manifest: `/t/${encodeURIComponent(tenantSlug)}/p/${productId}/manifest.webmanifest`,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{
    tenantSlug: string;
    productId: string;
    productPath?: string[];
  }>;
}) {
  const { tenantSlug, productId, productPath = [] } = await params;
  // [SAFETY] Membership, installation and permission resolve before any
  // product code loads (ADR-0004); every miss is a 404.
  const resolved = await getProductRegistry().resolvePage(
    resolvePlatformContext,
    { tenantSlug, productId, path: productPath },
  );
  if (resolved.status === 404) notFound();
  const Component = resolved.page;
  return (
    <Component
      pathSegments={productPath}
      products={resolved.products}
      routeId={resolved.route.id}
      tenantSlug={tenantSlug}
    />
  );
}
