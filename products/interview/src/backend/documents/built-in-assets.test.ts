import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { builtInAssetUrl } from "./built-in-assets";
import { builtInTemplates } from "./built-in-templates";
import { inspectTemplate } from "./template-intake";

describe("the built-in template stand-ins", () => {
  it("each template has its own asset file, named as the template says", () => {
    for (const template of builtInTemplates())
      expect(
        builtInAssetUrl(template.key).pathname.endsWith(template.asset),
      ).toBe(true);
  });

  it("reads three different files that each pass the template check in their own format", async () => {
    const read = new Map<string, Buffer>();
    for (const template of builtInTemplates()) {
      const bytes = await readFile(builtInAssetUrl(template.key));
      read.set(template.key, bytes);
      await expect(
        inspectTemplate({ format: template.format, bytes }),
      ).resolves.toMatchObject({ fields: expect.any(Array) });
    }
    // A bundle that resolved every asset to one file would make these equal.
    expect(
      new Set([...read.values()].map((bytes) => bytes.toString("hex"))).size,
    ).toBe(read.size);
  });
});
