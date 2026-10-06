import type { PlatformContext } from "@omnitech/platform-contracts";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { localSignInBypass } from "./fake-auth";

const localContext: PlatformContext = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "local@omnitech.test",
    displayName: "Local User",
    avatarUrl: null,
  },
  tenant: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "local",
    name: "Local Workspace",
  },
  membership: {
    tenantId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
  },
  preferences: { theme: "system", locale: "en" },
  permissions: [
    "platform.read",
    "artifact.read",
    "artifact.write",
    "interview.read",
    "interview.write",
    "presentation.read",
    "presentation.write",
    "presentation.share",
    "tenant.manage",
  ],
  // The tenant's own installations replace these once it is resolved.
  products: [],
};

// The bootstrapped local owner and tenant, for fake sign-in in development,
// resolved through the same tenant-scoped membership read as a real sign-in.
async function resolveLocalContext(): Promise<PlatformContext | null> {
  const [{ getPlatformDatabase }, { PlatformRepository }] = await Promise.all([
    import("@omnitech/database"),
    import("@omnitech/platform-storage"),
  ]);
  const resolved = await new PlatformRepository(
    getPlatformDatabase(),
  ).resolveContext(localContext.user.email, localContext.tenant.slug);
  if (!resolved) return null;
  return {
    ...localContext,
    user: { ...localContext.user, id: resolved.user.id },
    tenant: {
      ...localContext.tenant,
      id: resolved.tenant.id,
      name: resolved.tenant.name,
    },
    membership: {
      ...localContext.membership,
      tenantId: resolved.tenant.id,
      userId: resolved.user.id,
    },
    preferences: resolved.preferences,
    permissions: resolved.permissions,
    products: resolved.products,
  };
}

// [STRATEGY] The tenant layout and the product page both resolve the member's
// context in one request; `cache` (react-best-practices server-cache-react)
// makes that one membership read per request, not two.
export const resolvePlatformContext = cache(async function resolve(
  tenantSlug: string,
): Promise<PlatformContext | null> {
  if (localSignInBypass()) {
    return tenantSlug === localContext.tenant.slug
      ? await resolveLocalContext()
      : null;
  }

  const session = await auth();
  if (!session?.user?.email) return null;
  const [{ getPlatformDatabase }, { PlatformRepository }] = await Promise.all([
    import("@omnitech/database"),
    import("@omnitech/platform-storage"),
  ]);
  return new PlatformRepository(getPlatformDatabase()).resolveContext(
    session.user.email,
    tenantSlug,
  );
});

// [SAFETY] A tenant route that resolves no context ends here. Nobody signed in
// goes to sign-in, which names no tenant: the native shell starts its sign-in
// round trip when its web view reaches /sign-in, so a bare 404 would strand the
// panel on "This page could not be found". Someone signed in who is not a
// member (or asks for an unknown tenant) gets the same 404 as before, so a
// response never reveals whether a tenant exists.
export async function refuseTenantAccess(): Promise<never> {
  const signedOut = !localSignInBypass() && !(await auth())?.user?.email;
  if (signedOut) redirect("/sign-in");
  notFound();
}
