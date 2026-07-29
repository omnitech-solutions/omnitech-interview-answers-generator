import { productManifestSchema } from "@omnitech/platform-contracts";
import { describe, expect, it } from "vitest";
import { frontendPlugin, manifest } from "./manifest.js";

describe("presentation product manifest", () => {
  it("declares a frontend loader for every route", () => {
    expect(productManifestSchema.parse(manifest).id).toBe(
      "omnitech.presentation",
    );
    expect(Object.keys(frontendPlugin.routes).sort()).toEqual(
      manifest.routes.map((route) => route.id).sort(),
    );
  });

  it("keeps model vendors out of product configuration", () => {
    expect(JSON.stringify(manifest)).not.toMatch(
      /openai|anthropic|codex|claude|fal|together|comfyui/i,
    );
  });
});
