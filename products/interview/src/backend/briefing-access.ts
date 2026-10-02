import type { PlatformContext } from "@omnitech/platform-contracts";
import type { WorkspaceScope } from "./assistant/workspace.js";

/** Resolve private product scope only after the host authenticates the session. */
export function briefingScope(
  context: PlatformContext | null,
  tenantSlug: string,
  method: string,
): WorkspaceScope | null {
  if (
    !context ||
    context.tenant.slug !== tenantSlug ||
    context.membership.tenantId !== context.tenant.id ||
    context.membership.userId !== context.user.id ||
    !context.products.some(
      (product) =>
        product.productId === "omnitech.interview" && product.enabled,
    ) ||
    !context.permissions.includes("interview.read") ||
    (method !== "GET" && !context.permissions.includes("interview.write"))
  )
    return null;
  return {
    tenantId: context.tenant.id,
    actorId: context.user.id,
    productId: "omnitech.interview",
  };
}
