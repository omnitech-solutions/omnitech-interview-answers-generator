import { resolveProductPage } from "@omnitech/platform-api";
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
  const resolved = await resolveProductPage(
    {
      resolveContext: resolvePlatformContext,
      products: getProductRegistry().list(),
    },
    { tenantSlug, productId, path: productPath },
  );
  if (resolved.status === 404) notFound();
  const Component = resolved.page;
  return (
    <Component
      pathSegments={productPath}
      routeId={resolved.route.id}
      tenantSlug={tenantSlug}
    />
  );
}
