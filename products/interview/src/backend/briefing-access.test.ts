import type { PlatformContext } from "@omnitech/platform-contracts";
import { describe, expect, it } from "vitest";
import * as access from "./briefing-access.js";

const context = {
  tenant: { id: "tenant-id", slug: "team" },
  user: { id: "member" },
  membership: { tenantId: "tenant-id", userId: "member" },
  permissions: ["interview.read", "interview.write"],
  products: [{ productId: "omnitech.interview", enabled: true }],
} as PlatformContext;
describe("briefing platform authorization", () => {
  it("requires matching membership, installation and write permission before resolving private scope", () => {
    expect(access.briefingScope(context, "team", "GET")).toEqual({
      tenantId: "tenant-id",
      actorId: "member",
      productId: "omnitech.interview",
    });
    expect(access.briefingScope(null, "team", "GET")).toBeNull();
    expect(access.briefingScope(context, "other", "GET")).toBeNull();
    expect(
      access.briefingScope(
        { ...context, membership: { ...context.membership, userId: "other" } },
        "team",
        "GET",
      ),
    ).toBeNull();
    expect(
      access.briefingScope({ ...context, products: [] }, "team", "GET"),
    ).toBeNull();
    const reader = { ...context, permissions: ["interview.read"] };
    expect(access.briefingScope(reader, "team", "POST")).toBeNull();
    expect(access.briefingScope(reader, "team", "GET")).not.toBeNull();
  });
});
