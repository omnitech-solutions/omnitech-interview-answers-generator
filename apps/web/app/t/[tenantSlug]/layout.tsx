import type { ReactNode } from "react";

import {
  refuseTenantAccess,
  resolvePlatformContext,
} from "@/src/platform/context";
import { PlatformShell } from "@/src/platform/platform-shell";
import { productFrames } from "@/src/platform/registry";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const context = await resolvePlatformContext(tenantSlug);
  if (!context) return refuseTenantAccess();
  return (
    <PlatformShell context={context} frames={productFrames()}>
      {children}
    </PlatformShell>
  );
}
