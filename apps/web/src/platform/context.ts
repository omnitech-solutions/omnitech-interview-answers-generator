import type { PlatformContext } from "@omnitech/platform-contracts";

import { auth } from "@/auth";
import { localInterviewInstallation } from "./catalog";

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
    "tenant.manage",
  ],
  products: [localInterviewInstallation],
};

export async function resolvePlatformContext(
  tenantSlug: string,
): Promise<PlatformContext | null> {
  const session = await auth();
  if (!process.env["DATABASE_URL"]) {
    return tenantSlug === localContext.tenant.slug ? localContext : null;
  }
  if (!session?.user?.email) return null;
  const { getPlatformDatabase, PlatformRepository } = await import(
    "@omnitech/platform-storage"
  );
  return new PlatformRepository(getPlatformDatabase()).resolveContext(
    session.user.email,
    tenantSlug,
  );
}
