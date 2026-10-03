import { describe, expect, it } from "vitest";
import { productManifestSchema } from "./plugin.js";

const manifest = {
  schemaVersion: 1,
  id: "omnitech.interview",
  version: "1.0.0",
  platformVersion: "^1.0.0",
  defaultName: "Interview",
  defaultDescription: "Prepare and practise",
  icon: "code",
  permissions: ["interview.read"],
  routes: [
    {
      id: "interview.workspace",
      defaultPath: "/workspace",
      frontendEntry: "workspace.page",
      requiredPermission: "interview.read",
    },
  ],
  navigation: [
    {
      routeId: "interview.workspace",
      defaultLabel: "Workspace",
      defaultDescription: "Prepare answers",
      group: "Workspaces",
      order: 10,
    },
  ],
  configurationSchema: {},
} as const;

describe("productManifestSchema", () => {
  it("accepts a complete product manifest", () => {
    expect(productManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("accepts a registered frame and rejects any other", () => {
    expect(
      productManifestSchema.parse({ ...manifest, frame: "fill-viewport" })
        .frame,
    ).toBe("fill-viewport");
    expect(() =>
      productManifestSchema.parse({ ...manifest, frame: "interview" }),
    ).toThrow();
  });

  it("rejects an unnamespaced route id", () => {
    expect(() =>
      productManifestSchema.parse({
        ...manifest,
        routes: [{ ...manifest.routes[0], id: "Invalid route" }],
      }),
    ).toThrow();
  });
});
