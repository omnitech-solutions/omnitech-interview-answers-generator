import { describe, expect, it } from "vitest";
import { exportPresentation } from "./export/index.js";
import { parseSlideBlocks } from "./frontend/slide-blocks.js";
import { createParityFixtures } from "./parity-fixtures.js";

describe("presentation parity fixtures", () => {
  const fixtures = createParityFixtures();

  it("covers the required representative product states", () => {
    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      "blank",
      "ai",
      "custom-theme",
      "imported-theme",
      "diagram",
      "infographic",
      "image",
      "shared",
      "recorded-exported",
    ]);
  });

  it("keeps representative content, media, sharing, and themes executable", async () => {
    for (const fixture of fixtures) {
      const source = fixture.document.slides[0]?.sourceXml ?? "";
      expect(parseSlideBlocks(source).length).toBeGreaterThan(0);
      if (fixture.theme)
        expect(fixture.theme.definition["accent"]).toMatch(/^#/);
      if (fixture.imageDataUrl)
        expect(fixture.imageDataUrl).toMatch(/^data:image\//);
      if (fixture.shareToken)
        expect(fixture.shareToken).toMatch(/^[a-z0-9-]{20,}$/);
      if (fixture.recordingDataUrl)
        expect(fixture.recordingDataUrl).toMatch(/^data:video\//);
    }

    const exported = fixtures.find(
      (fixture) => fixture.name === "recorded-exported",
    );
    if (!exported) throw new Error("Missing recorded/exported fixture.");
    await expect(
      exportPresentation(exported.document, "pptx"),
    ).resolves.toMatch(
      /^data:application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation;base64,/,
    );
    await expect(exportPresentation(exported.document, "pdf")).resolves.toMatch(
      /^data:application\/pdf;base64,/,
    );
  });
});
