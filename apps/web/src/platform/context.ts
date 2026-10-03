import type { PlatformContext } from "@omnitech/platform-contracts";

import { auth } from "@/auth";
import {
  localInterviewInstallation,
  localPresentationInstallation,
} from "./catalog";

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
  products: [localInterviewInstallation, localPresentationInstallation],
};

// The bootstrapped local owner and tenant, for fake sign-in in development.
async function resolveLocalContext(): Promise<PlatformContext | null> {
  const { getPlatformDatabase } = await import("@omnitech/database");
  const result = await getPlatformDatabase().query<{
    user_id: string;
    tenant_id: string;
    tenant_name: string;
    theme: "system" | "light" | "dark" | null;
    locale: string | null;
    ai_profile_id: string | null;
  }>(
    `SELECT u.id AS user_id, t.id AS tenant_id, t.name AS tenant_name,
            p.theme, p.locale, p.ai_profile_id
     FROM platform.users u
     JOIN platform.tenant_memberships m ON m.user_id = u.id
     JOIN platform.tenants t ON t.id = m.tenant_id
     LEFT JOIN platform.user_preferences p ON p.user_id = u.id
     WHERE u.email = $1 AND t.slug = $2
     LIMIT 1`,
    [localContext.user.email, localContext.tenant.slug],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...localContext,
    user: { ...localContext.user, id: row.user_id },
    tenant: {
      ...localContext.tenant,
      id: row.tenant_id,
      name: row.tenant_name,
    },
    membership: {
      ...localContext.membership,
      tenantId: row.tenant_id,
      userId: row.user_id,
    },
    preferences: {
      theme: row.theme ?? "system",
      locale: row.locale ?? "en",
      ...(row.ai_profile_id === null ? {} : { aiProfileId: row.ai_profile_id }),
    },
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
