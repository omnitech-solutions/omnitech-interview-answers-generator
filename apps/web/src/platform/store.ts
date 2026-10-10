import "./server-only";
import type { PlatformRepository } from "@omnitech/platform-storage";

// The one place the shell reaches the platform's own records (users, tenants,
// memberships, preferences, connected accounts). Sign-in, tenant resolution
// and the integration routes ask here; none of them holds a connection or
// builds a repository. Loaded on first use, so `next build` and a page that
// reads nothing never open the database.
export async function platformRepository(): Promise<PlatformRepository> {
  const [{ getPlatformDatabase }, { PlatformRepository }] = await Promise.all([
    import("@omnitech/database"),
    import("@omnitech/platform-storage"),
  ]);
  return new PlatformRepository(getPlatformDatabase());
}
