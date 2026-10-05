import { describe, expect, it } from "vitest";
import { frontendPlugin, manifest } from "./manifest";

describe("interview manifest", () => {
  it("serves the Live session view at /live under interview.read, with no new permission", () => {
    const live = manifest.routes.find((route) => route.id === "interview.live");
    expect(live).toMatchObject({
      defaultPath: "/live",
      requiredPermission: "interview.read",
      frontendEntry: "studio.page",
    });
    expect(manifest.permissions).toEqual([
      "interview.read",
      "interview.write",
      "interview.documents.write",
    ]);
    expect(Object.keys(frontendPlugin.routes)).toContain("interview.live");
  });

  it("keeps one route per Studio view, each under interview.read", () => {
    expect(manifest.routes.map((route) => route.defaultPath)).toEqual([
      "/",
      "/work",
      "/briefings",
      "/documents",
      "/knowledge",
      "/rehearsal",
      "/live",
    ]);
    for (const route of manifest.routes)
      expect(route.requiredPermission).toBe("interview.read");
  });
});
