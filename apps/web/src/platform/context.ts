import "./server-only";
import type { PlatformContext } from "@omnitech/platform-contracts";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import { LOCAL_USER_EMAIL, localSignInBypass } from "./fake-auth";
import { REQUESTED_PATH_HEADER } from "./request-path";
import { safeReturnTarget, signInPath } from "./return-target";
import { platformRepository } from "./store";

const localContext: PlatformContext = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: LOCAL_USER_EMAIL,
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
  const resolved = await (await platformRepository()).resolveContext(
    localContext.user.email,
    localContext.tenant.slug,
  );
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
  return (await platformRepository()).resolveContext(
    session.user.email,
    tenantSlug,
  );
});

// [SAFETY] A tenant route that resolves no context ends here. Nobody signed in
// goes to sign-in carrying the page they asked for (`next`, validated: only a
// same-origin /t/ path survives). The native shell starts its sign-in round
// trip when its web view reaches /sign-in, so a bare 404 would strand the
// panel. Someone signed in who is not a member (or asks for an unknown tenant)
// gets the same 404 as before, so a response never reveals whether a tenant
// exists.
export async function refuseTenantAccess(next?: string): Promise<never> {
  const signedOut = !localSignInBypass() && !(await auth())?.user?.email;
  if (signedOut) {
    const target =
      safeReturnTarget(next) ??
      safeReturnTarget((await headers()).get(REQUESTED_PATH_HEADER));
    redirect(signInPath(target));
  }
  notFound();
}
