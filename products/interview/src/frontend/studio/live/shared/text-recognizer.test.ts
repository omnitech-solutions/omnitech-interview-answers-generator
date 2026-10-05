import {
  LIVE_OCR_LIMITS,
  liveOcrBlockSchema,
  type StudioHostCapability,
  type StudioHostInfo,
} from "@omnitech/interview-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  capOcrText,
  chooseRecognizer,
  NO_RECOGNIZER,
  ocrBlockFor,
  ocrBlocksForRequest,
  type RecognizedText,
  type TextRecognizer,
} from "./text-recognizer";

const hostWith = (...capabilities: StudioHostCapability[]): StudioHostInfo => ({
  host: { recognizeText: vi.fn() } as unknown as StudioHostInfo["host"],
  capabilities: new Set(capabilities),
});
const wasm = (available: boolean): TextRecognizer => ({
  engine: "tesseract",
  available,
  recognize: async () => ({ ok: false, reason: "unavailable" }),
});
const read = (over: Partial<RecognizedText> = {}): RecognizedText => ({
  ok: true,
  engine: "vision",
  text: "const a = 1",
  confidence: 0.9,
  truncated: false,
  ...over,
});

describe("chooseRecognizer", () => {
  const cases: {
    name: string;
    info: StudioHostInfo | null;
    wasm: TextRecognizer | null;
    engine: string | null;
    available: boolean;
  }[] = [
    {
      name: "native host advertising text-recognition wins over wasm",
      info: hostWith("capture-screen", "text-recognition"),
      wasm: wasm(true),
      engine: "vision",
      available: true,
    },
    {
      name: "native host without the capability falls to wasm",
      info: hostWith("capture-screen"),
      wasm: wasm(true),
      engine: "tesseract",
      available: true,
    },
    {
      name: "no host uses wasm",
      info: null,
      wasm: wasm(true),
      engine: "tesseract",
      available: true,
    },
    {
      name: "wasm that cannot run is not chosen",
      info: null,
      wasm: wasm(false),
      engine: null,
      available: false,
    },
    {
      name: "nothing at all is the explicit none recognizer",
      info: null,
      wasm: null,
      engine: null,
      available: false,
    },
  ];
  it.each(cases)("$name", ({ info, wasm: w, engine, available }) => {
    const chosen = chooseRecognizer(info, w);
    expect(chosen.engine).toBe(engine);
    expect(chosen.available).toBe(available);
  });

  it("the none recognizer reports unavailable and never throws", async () => {
    await expect(
      NO_RECOGNIZER.recognize(new Blob(["x"], { type: "image/png" })),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("ocrBlockFor", () => {
  it("maps a result to a block the upload schema accepts", () => {
    const block = ocrBlockFor(read({ text: "  line 1\r\nline 2  " }));
    expect(block).toEqual({
      engine: "vision",
      text: "line 1\nline 2",
      confidence: 0.9,
    });
    expect(liveOcrBlockSchema.safeParse(block).success).toBe(true);
  });

  it("is null for a failure, no result, or blank text", () => {
    expect(ocrBlockFor({ ok: false, reason: "timeout" })).toBeNull();
    expect(ocrBlockFor(null)).toBeNull();
    expect(ocrBlockFor(undefined)).toBeNull();
    expect(ocrBlockFor(read({ text: " \n\t " }))).toBeNull();
  });

  it("omits an unknown confidence and clamps a wild one", () => {
    expect(ocrBlockFor(read({ confidence: null }))).toEqual({
      engine: "vision",
      text: "const a = 1",
    });
    expect(ocrBlockFor(read({ confidence: 7 }))?.confidence).toBe(1);
    expect(ocrBlockFor(read({ confidence: -1 }))?.confidence).toBe(0);
    expect(ocrBlockFor(read({ confidence: Number.NaN }))).not.toHaveProperty(
      "confidence",
    );
  });

  it("strips NUL bytes and holds the text to the per-image bound at a line", () => {
    const line = `${"x".repeat(99)}\n`;
    const block = ocrBlockFor(
      read({ text: `a\u0000b\n${line.repeat(400)}`, engine: "tesseract" }),
    );
    expect(block?.text.startsWith("ab\n")).toBe(true);
    expect(block?.text.length).toBeLessThanOrEqual(
      LIVE_OCR_LIMITS.maxTextPerImage,
    );
    expect(block?.text.endsWith("x")).toBe(true);
    expect(liveOcrBlockSchema.safeParse(block).success).toBe(true);
  });

  it("never throws on a malformed result", () => {
    expect(
      ocrBlockFor({ ok: true, engine: "bogus", text: "t" } as never),
    ).toBeNull();
    expect(
      ocrBlockFor({ ok: true, engine: "vision", text: 5 } as never),
    ).toBeNull();
    expect(ocrBlockFor("nope" as never)).toBeNull();
  });
});

describe("metrics of cut text (D35: doubt sends the image)", () => {
  const metrics = {
    coverage: 0.9,
    meanConfidence: 0.9,
    largestGap: 0.1,
    boxes: 40,
  };
  it("keeps metrics for whole text, drops them when the engine truncated", () => {
    const whole = {
      ok: true,
      engine: "vision",
      text: "hello",
      metrics,
    } as const;
    expect(ocrBlockFor(whole as never)?.metrics).toEqual(metrics);
    expect(
      ocrBlockFor({ ...whole, truncated: true } as never),
    ).not.toHaveProperty("metrics");
  });
  it("drops metrics when the text was cut to the per-image bound", () => {
    const text = `${"x".repeat(99)}\n`.repeat(400);
    expect(
      ocrBlockFor({ ok: true, engine: "vision", text, metrics } as never),
    ).not.toHaveProperty("metrics");
  });
  it("drops metrics of a block trimmed to the request bound, keeps them otherwise", () => {
    const text = `${"y".repeat(99)}\n`.repeat(170);
    const full = { engine: "vision" as const, text, metrics };
    const out = ocrBlocksForRequest([full, full, full, full]);
    expect(out[0]).toHaveProperty("metrics");
    const trimmed = out.find((b) => b && b.text !== text);
    expect(trimmed).toBeTruthy();
    expect(trimmed).not.toHaveProperty("metrics");
  });
});

describe("capOcrText", () => {
  it("leaves short text alone", () => {
    expect(capOcrText("abc", 10)).toEqual({ text: "abc", truncated: false });
  });
  it("does not split a surrogate pair", () => {
    const { text, truncated } = capOcrText("ab😀cd", 3);
    expect(truncated).toBe(true);
    expect(text).toBe("ab");
  });
});

describe("ocrBlocksForRequest", () => {
  const block = (n: number) => ({
    engine: "vision" as const,
    text: `${"y".repeat(99)}\n`.repeat(n / 100),
  });
  it("keeps early images whole and trims later ones to the request bound", () => {
    const out = ocrBlocksForRequest([
      block(20_000),
      block(20_000),
      block(20_000),
      block(20_000),
    ]);
    const total = out.reduce((sum, b) => sum + (b?.text.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(LIVE_OCR_LIMITS.maxTextPerRequest);
    expect(out[0]?.text).toBe(block(20_000).text);
    expect(out[3]).toBeNull();
  });
  it("keeps order and nulls", () => {
    const small = { engine: "tesseract" as const, text: "hi" };
    expect(ocrBlocksForRequest([null, small, null])).toEqual([
      null,
      small,
      null,
    ]);
  });
});
