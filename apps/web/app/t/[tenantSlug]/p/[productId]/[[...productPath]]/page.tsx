import { notFound } from "next/navigation";
import React from "react";

import { resolvePlatformContext } from "@/src/platform/context";
import { getProductRegistry, resolveProductId } from "@/src/platform/registry";

export default async function ProductPage({
  params,
}: {
  params: Promise<{
    tenantSlug: string;
    productId: string;
    productPath?: string[];
  }>;
}) {
  const {
    tenantSlug,
    productId: routeProductId,
    productPath = [],
  } = await params;
  const context = await resolvePlatformContext(tenantSlug);
  const productId = resolveProductId(routeProductId);
  if (!context || !productId) notFound();

  const installation = context.products.find(
    (product) => product.productId === productId,
  );
  if (!installation?.enabled) notFound();

  const product = getProductRegistry().get(productId);
  const requestedPath = `/${productPath.join("/")}`;
  const route = product.manifest.routes.find(
    (candidate) =>
      candidate.defaultPath === requestedPath ||
      requestedPath.startsWith(`${candidate.defaultPath}/`) ||
      installation.navigation.routes[candidate.id]?.path.endsWith(
        requestedPath,
      ),
  );
  if (!route || !context.permissions.includes(route.requiredPermission)) {
    notFound();
  }

  const module = await product.frontend.routes[route.id]?.();
  if (!module) notFound();
  const Component = module.default;
  return (
    <Component
      pathSegments={productPath}
      routeId={route.id}
      tenantSlug={tenantSlug}
    />
  );
}
