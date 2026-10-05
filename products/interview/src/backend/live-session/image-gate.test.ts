import type { LiveOcrBlock } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { IMAGE_GATE_THRESHOLDS, imageGate, looksLikeCode } from "./image-gate";

const PROSE = [
  "Tell me about a time you disagreed with a teammate.",
  "How did you resolve it and what did you learn from it?",
  "Please keep your answer under two minutes.",
].join("\n");

const clean = (over: Partial<LiveOcrBlock> = {}): LiveOcrBlock => ({
  engine: "vision",
  text: PROSE,
  confidence: 0.97,
  metrics: { coverage: 0.8, meanConfidence: 0.97, largestGap: 0.05, boxes: 12 },
  ...over,
});
const withMetrics = (m: Partial<NonNullable<LiveOcrBlock["metrics"]>>) =>
  clean({ metrics: { ...(clean().metrics as object), ...m } as never });

describe("thresholds", () => {
  it("are pinned (a change is a reviewed decision)", () => {
    expect(IMAGE_GATE_THRESHOLDS).toEqual({
      minCoverage: 0.6,
      minMeanConfidence: 0.85,
      maxLargestGap: 0.15,
      minBoxes: 3,
      maxTextChars: 12_000,
      codeLineFraction: 0.25,
      codeMinLines: 2,
      symbolDensity: 0.04,
    });
  });
});

describe("imageGate: settings", () => {
  it("always sends the image whatever the text says", () => {
    expect(imageGate("always", clean(), "permitted-remote")).toEqual({
      sent: "image",
      reason: "setting-always",
    });
    expect(imageGate("always", null, "permitted-remote").sent).toBe("image");
  });

  it("never withholds every image: text only when there is text, else nothing", () => {
    expect(imageGate("never", clean(), "permitted-remote").sent).toBe(
      "text-only",
    );
    expect(imageGate("never", null, "permitted-remote").sent).toBe("none");
    expect(
      imageGate("never", clean({ text: "" }), "permitted-remote").sent,
    ).toBe("none");
    // even a code frame or a diagram: never means never
    expect(
      imageGate("never", withMetrics({ largestGap: 0.9 }), "permitted-remote")
        .sent,
    ).toBe("text-only");
  });

  it("a device-only session sends nothing under any setting", () => {
    for (const setting of ["always", "text-only-when-text", "never"] as const)
      expect(imageGate(setting, clean(), "device-only")).toEqual({
        sent: "none",
        reason: "device-only",
      });
  });
});

describe("imageGate: text-only-when-text", () => {
  const gate = (block: LiveOcrBlock | null | undefined) =>
    imageGate("text-only-when-text", block, "permitted-remote");

  it("a clean prose frame goes as text only", () => {
    expect(gate(clean())).toEqual({ sent: "text-only", reason: "clean-text" });
  });

  it.each([
    ["no block", null, "no-ocr"],
    ["undefined block", undefined, "no-ocr"],
    ["tesseract", clean({ engine: "tesseract" }), "engine-not-native"],
    ["empty text", clean({ text: "" }), "no-text"],
    ["missing metrics", clean({ metrics: undefined }), "no-metrics"],
    ["text too long", clean({ text: "x".repeat(12_001) }), "text-too-long"],
    ["few boxes", withMetrics({ boxes: 2 }), "few-boxes"],
    ["low coverage", withMetrics({ coverage: 0.59 }), "low-coverage"],
    [
      "low metric confidence",
      withMetrics({ meanConfidence: 0.84 }),
      "low-confidence",
    ],
    ["low block confidence", clean({ confidence: 0.84 }), "low-confidence"],
    ["large gap (a diagram)", withMetrics({ largestGap: 0.16 }), "large-gap"],
  ] as const)("any doubt sends the image: %s", (_name, block, reason) => {
    expect(gate(block as never)).toEqual({ sent: "image", reason });
  });

  it("thresholds are inclusive at the boundary and exclusive beyond it", () => {
    expect(gate(withMetrics({ coverage: 0.6 })).sent).toBe("text-only");
    expect(gate(withMetrics({ meanConfidence: 0.85 })).sent).toBe("text-only");
    expect(gate(clean({ confidence: 0.85 })).sent).toBe("text-only");
    expect(gate(withMetrics({ largestGap: 0.15 })).sent).toBe("text-only");
    expect(gate(withMetrics({ boxes: 3 })).sent).toBe("text-only");
    expect(
      gate(
        clean({ text: `${PROSE}\n${"y".repeat(12_000 - PROSE.length - 1)}` }),
      ).sent,
    ).toBe("text-only");
  });

  it("a missing block confidence does not by itself force the image", () => {
    const { confidence: _c, ...rest } = clean();
    expect(gate(rest as LiveOcrBlock).sent).toBe("text-only");
  });

  it("a code frame always keeps the image, even when everything else is perfect", () => {
    const code = [
      "function twoSum(nums, target) {",
      "const seen = new Map();",
      "for (let i = 0; i < nums.length; i++) {",
      "const need = target - nums[i];",
      "if (seen.has(need)) return [seen.get(need), i];",
      "}",
      "}",
    ].join("\n");
    expect(gate(clean({ text: code }))).toEqual({
      sent: "image",
      reason: "looks-like-code",
    });
  });
});

describe("looksLikeCode", () => {
  it("recognises braces, operators and keywords; not prose", () => {
    expect(looksLikeCode(PROSE)).toBe(false);
    expect(looksLikeCode("")).toBe(false);
    expect(looksLikeCode("def solve(a, b):\nreturn a + b")).toBe(true);
    expect(looksLikeCode("x = y == z\nwhile (a) {")).toBe(true);
    expect(looksLikeCode("a[i] = (b[j] + c[k]) * d[l];")).toBe(true);
  });

  it("an ordinary sentence with a parenthesis or a colon is still prose", () => {
    expect(
      looksLikeCode(
        "Describe your role (and the team size).\nWhy did you leave: tell me the story.",
      ),
    ).toBe(false);
  });
});
