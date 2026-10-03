import type { PlatformContext } from "@omnitech/platform-contracts";

import { auth } from "@/auth";

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
    products: resolved.products,
  };
}

export async function resolvePlatformContext(
  tenantSlug: string,
): Promise<PlatformContext | null> {
  const localFakeAuth =
    process.env["NODE_ENV"] !== "production" &&
    process.env["FAKE_AUTH_ENABLED"] === "true";
  if (localFakeAuth) {
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
}
