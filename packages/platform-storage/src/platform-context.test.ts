import { describe, expect, it } from "vitest";
import {
  type ContextRow,
  rolePermissions,
  toPlatformContext,
} from "./platform-context";

const member = [
  "platform.read",
  "artifact.read",
  "interview.read",
  "interview.documents.write",
  "presentation.read",
];
const admin = [
  ...member,
  "artifact.write",
  "interview.write",
  "presentation.write",
  "presentation.share",
  "tenant.manage",
];

describe("role permissions", () => {
  it("grants each role exactly its list, in order", () => {
    expect(rolePermissions("member")).toEqual(member);
    expect(rolePermissions("admin")).toEqual(admin);
    expect(rolePermissions("owner")).toEqual([...admin, "tenant.delete"]);
  });

  it("hands out a fresh list, so a caller cannot widen a role", () => {
    rolePermissions("member").push("tenant.delete");
    expect(rolePermissions("member")).toEqual(member);
  });
});

describe("a member's context", () => {
  const row: ContextRow = {
    user_id: "user-1",
    email: "ada@example.test",
    display_name: "Ada",
    avatar_url: null,
    tenant_id: "tenant-1",
    tenant_slug: "north",
    tenant_name: "North Lab",
    role: "admin",
    theme: "dark",
    locale: "fr",
    ai_profile_id: "profile-1",
  };

  it("is shaped from the person, the tenant, the role and the products", () => {
    expect(toPlatformContext(row, [])).toEqual({
      user: {
        id: "user-1",
        email: "ada@example.test",
        displayName: "Ada",
        avatarUrl: null,
      },
      tenant: { id: "tenant-1", slug: "north", name: "North Lab" },
      membership: { tenantId: "tenant-1", userId: "user-1", role: "admin" },
      preferences: { theme: "dark", locale: "fr", aiProfileId: "profile-1" },
      permissions: admin,
      products: [],
    });
  });

  it("defaults the preferences of a person who never saved any", () => {
    // The preferences join is a LEFT JOIN, so its columns arrive as null.
    const unsaved = {
      ...row,
      theme: null,
      locale: null,
      ai_profile_id: null,
    } as unknown as ContextRow;
    expect(toPlatformContext(unsaved, []).preferences).toEqual({
      theme: "system",
      locale: "en",
    });
  });
});
