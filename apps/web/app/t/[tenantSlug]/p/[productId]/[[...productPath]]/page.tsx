import { notFound } from "next/navigation";
import React from "react";

import { resolvePlatformContext } from "@/src/platform/context";
import { getProductRegistry } from "@/src/platform/registry";

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
