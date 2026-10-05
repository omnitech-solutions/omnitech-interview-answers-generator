import { describe, expect, it } from "vitest";
import {
  ACTUAL,
  FIT,
  pan,
  stepScale,
  VIEWER_KEYS,
  ZOOM_STEPS,
  zoom,
  zoomLabel,
} from "./image-viewer-model";

describe("zoom", () => {
  it("steps through the table and stops at both ends", () => {
    expect(stepScale(1, 1)).toBe(1.5);
    expect(stepScale(1, -1)).toBe(0.75);
    expect(stepScale(ZOOM_STEPS.at(-1) ?? 4, 1)).toBe(4);
    expect(stepScale(0.25, -1)).toBe(0.25);
  });
  it("zooming out of Fit starts from the scale Fit resolved to", () => {
    expect(zoom(FIT, -1, 0.6).scale).toBe(0.5);
    expect(zoom(FIT, 1, 0.6).scale).toBe(0.75);
    expect(zoom(FIT, 1, 0.6).fit).toBe(false);
  });
  it("labels Fit and the percentage", () => {
    expect(zoomLabel(FIT)).toBe("Fit");
    expect(zoomLabel(ACTUAL)).toBe("100%");
    expect(zoomLabel({ ...ACTUAL, scale: 1.5 })).toBe("150%");
  });
});

describe("pan", () => {
  const natural = { w: 1000, h: 500 };
  it("does nothing in Fit", () => {
    expect(pan(FIT, 40, 40, natural)).toBe(FIT);
  });
  it("moves and never carries the image further than half off centre", () => {
    expect(pan(ACTUAL, -30, 10, natural)).toMatchObject({ x: -30, y: 10 });
    expect(pan(ACTUAL, 99_999, -99_999, natural)).toMatchObject({
      x: 500,
      y: -250,
    });
  });
});

describe("shortcuts", () => {
  it("documents every key it handles", () => {
    expect(VIEWER_KEYS.map((key) => key.does)).toEqual([
      "zoom in",
      "zoom out",
      "fit",
      "100%",
    ]);
    expect(VIEWER_KEYS.find((key) => key.match({ key: "=" }))?.run).toBe("in");
    expect(VIEWER_KEYS.find((key) => key.match({ key: "F" }))?.run).toBe("fit");
  });
});

describe("zoom keeps the pan inside the image", () => {
  it("re-clamps the offset to the new, smaller scale", () => {
    const natural = { w: 1000, h: 800 };
    const out = zoom(
      { fit: false, scale: 4, x: 1900, y: 1500 },
      -1,
      4,
      natural,
    );
    expect(out.scale).toBe(3);
    expect(out.x).toBe(1500);
    expect(out.y).toBe(1200);
    const smaller = zoom(
      { fit: false, scale: 0.5, x: 250, y: 0 },
      -1,
      0.5,
      natural,
    );
    expect(smaller.x).toBe(125);
  });
});
