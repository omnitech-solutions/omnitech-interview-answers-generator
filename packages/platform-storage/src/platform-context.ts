// What a signed-in member's context is made of, as pure functions and data:
// the permissions each membership role grants, and the shape the platform
// hands to products. No I/O; the repository beside this file reads the rows.
import type {
  InstalledProductSummary,
  PlatformContext,
} from "@omnitech/platform-contracts";

export type MembershipRole = "owner" | "admin" | "member";

// One person in one tenant, as the context query reads them.
export type ContextRow = {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  role: MembershipRole;
  theme: "system" | "light" | "dark";
  locale: string;
  ai_profile_id: string | null;
};

const memberPermissions = [
  "platform.read",
  "artifact.read",
  "interview.read",
  "interview.documents.write",
  "presentation.read",
] as const;

const adminPermissions = [
  ...memberPermissions,
  "artifact.write",
  "interview.write",
  "presentation.write",
  "presentation.share",
  "tenant.manage",
] as const;

// Each role holds everything the role below it holds, in this order.
const ROLE_PERMISSIONS: Record<MembershipRole, readonly string[]> = {
  member: memberPermissions,
  admin: adminPermissions,
  owner: [...adminPermissions, "tenant.delete"],
};

export const rolePermissions = (role: MembershipRole): string[] => [
  ...ROLE_PERMISSIONS[role],
];

// A person with no saved preferences reads as the system theme in English.
export function toPlatformContext(
  row: ContextRow,
  products: InstalledProductSummary[],
): PlatformContext {
  return {
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
    tenant: {
      id: row.tenant_id,
      slug: row.tenant_slug,
      name: row.tenant_name,
    },
    membership: {
      tenantId: row.tenant_id,
      userId: row.user_id,
      role: row.role,
    },
    preferences: {
      theme: row.theme ?? "system",
      locale: row.locale ?? "en",
      ...(row.ai_profile_id === null ? {} : { aiProfileId: row.ai_profile_id }),
    },
    permissions: rolePermissions(row.role),
    products,
  };
}
