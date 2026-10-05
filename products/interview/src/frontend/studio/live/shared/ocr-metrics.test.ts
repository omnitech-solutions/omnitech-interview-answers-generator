// D35: the page forwards the native text-box metrics, unchanged and validated,
// into every `ocr` entry it uploads (staged Apply, Auto and hands-free frames).
// Out of range or malformed means NO metrics (the server then sends the image).
import {
  liveOcrBlockSchema,
  type StudioHost,
} from "@omnitech/interview-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { captureThroughHost, forgetHostDisplay } from "../host-adapter";
import { ownerInputDeps } from "../session-owner-input";
import type { LiveSnapshot } from "../session-snapshot";
import { createNativeRecognizer } from "./native-recognizer";
import {
  ocrBlockFor,
  ocrBlockForHostCapture,
  ocrBlocksForRequest,
  type RecognizedText,
  validOcrMetrics,
} from "./text-recognizer";

const METRICS = {
  coverage: 0.82,
  meanConfidence: 0.93,
  largestGap: 0.04,
  boxes: 41,
};
const read = (over: Partial<RecognizedText> = {}): RecognizedText => ({
  ok: true,
  engine: "vision",
  text: "x = 1",
  confidence: 0.9,
  truncated: false,
  metrics: METRICS,
  ...over,
});

describe("validOcrMetrics", () => {
  it("keeps exactly the four fields when all are in range", () => {
    expect(validOcrMetrics(METRICS)).toEqual(METRICS);
    expect(
      validOcrMetrics({
        coverage: 0,
        meanConfidence: 1,
        largestGap: 1,
        boxes: 0,
      }),
    ).toEqual({ coverage: 0, meanConfidence: 1, largestGap: 1, boxes: 0 });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an array", [1, 2]],
    ["a string", "0.5"],
    [
      "a missing field",
      { coverage: 0.5, meanConfidence: 0.5, largestGap: 0.5 },
    ],
    ["an extra key (truncated)", { ...METRICS, truncated: false }],
    ["coverage above 1", { ...METRICS, coverage: 1.01 }],
    ["coverage below 0", { ...METRICS, coverage: -0.01 }],
    ["mean confidence NaN", { ...METRICS, meanConfidence: Number.NaN }],
    [
      "largest gap Infinity",
      { ...METRICS, largestGap: Number.POSITIVE_INFINITY },
    ],
    ["a string number", { ...METRICS, coverage: "0.5" }],
    ["fractional boxes", { ...METRICS, boxes: 1.5 }],
    ["negative boxes", { ...METRICS, boxes: -1 }],
    ["too many boxes", { ...METRICS, boxes: 100_001 }],
  ])("drops the whole object for %s", (_name, value) => {
    expect(validOcrMetrics(value)).toBeNull();
  });
});

describe("ocrBlockFor carries the metrics", () => {
  it("builds the exact wire object for a Vision read", () => {
    expect(ocrBlockFor(read())).toEqual({
      engine: "vision",
      text: "x = 1",
      confidence: 0.9,
      metrics: METRICS,
    });
    // Strict: the contract accepts it, and `truncated` never travels.
    const block = ocrBlockFor(read({ truncated: true }));
    expect(liveOcrBlockSchema.safeParse(block).success).toBe(true);
    expect(JSON.stringify(block)).not.toContain("truncated");
  });

  it("never sends metrics for Tesseract (it has none)", () => {
    expect(ocrBlockFor(read({ engine: "tesseract" }))).toEqual({
      engine: "tesseract",
      text: "x = 1",
      confidence: 0.9,
    });
  });

  it("sends no metrics key when they are absent, and keeps the text", () => {
    expect(ocrBlockFor(read({ metrics: undefined }))).toEqual({
      engine: "vision",
      text: "x = 1",
      confidence: 0.9,
    });
  });

  it("drops the whole metrics object if any field is out of range, keeps the text", () => {
    const block = ocrBlockFor(
      read({ metrics: { ...METRICS, meanConfidence: 1.2 } }),
    );
    expect(block).toEqual({ engine: "vision", text: "x = 1", confidence: 0.9 });
    expect(block).not.toHaveProperty("metrics");
  });

  it("keeps the metrics when the request bound shortens the text", () => {
    const block = ocrBlockFor(read({ text: "a".repeat(100) }));
    const [first, second] = ocrBlocksForRequest([block, block]);
    expect(first?.metrics).toEqual(METRICS);
    expect(second?.metrics).toEqual(METRICS);
  });
});

describe("the native recognizer hands the shell's metrics on", () => {
  it("reaches the upload block as the exact wire object", async () => {
    const host = {
      recognizeText: async () => ({
        ok: true,
        engine: "vision",
        text: "hello",
        confidence: 0.8,
        truncated: false,
        metrics: METRICS,
      }),
    } as unknown as Pick<StudioHost, "recognizeText">;
    const result = await createNativeRecognizer(host).recognize(
      new Blob(["hi"], { type: "image/png" }),
    );
    expect(ocrBlockFor(result)).toEqual({
      engine: "vision",
      text: "hello",
      confidence: 0.8,
      metrics: METRICS,
    });
  });

  it("an older shell with no metrics still reads", async () => {
    const host = {
      recognizeText: async () => ({
        ok: true,
        engine: "vision",
        text: "hello",
        confidence: 0.8,
        truncated: false,
      }),
    } as unknown as Pick<StudioHost, "recognizeText">;
    const result = await createNativeRecognizer(host).recognize(
      new Blob(["hi"], { type: "image/png" }),
    );
    expect(ocrBlockFor(result)).toEqual({
      engine: "vision",
      text: "hello",
      confidence: 0.8,
    });
  });
});

describe("a host capture's ocr (Auto and hands-free frames)", () => {
  afterEach(() => {
    forgetHostDisplay();
    delete window.studioHost;
  });
  const host = (ocr: unknown) => {
    window.studioHost = {
      version: 1,
      hostKind: "native-macos",
      capabilities: ["capture-screen"],
      captureScreen: async () => ({
        ok: true,
        mediaType: "image/jpeg",
        base64: btoa("\xff\xd8\xff\xe0JFIF"),
        ...(ocr === undefined ? {} : { ocr }),
      }),
    } as never;
  };

  it("carries the text and metrics onto the frame", async () => {
    host({
      engine: "vision",
      text: " hello ",
      confidence: 0.7,
      truncated: false,
      metrics: METRICS,
    });
    const frame = await captureThroughHost();
    expect(frame.ok && frame.ocr).toEqual({
      engine: "vision",
      text: "hello",
      confidence: 0.7,
      metrics: METRICS,
    });
  });

  it("has no ocr when the shell sent none or the text is empty", async () => {
    host(undefined);
    expect((await captureThroughHost()).ok && true).toBe(true);
    const frame = await captureThroughHost();
    expect(frame.ok && frame.ocr).toBeNull();
    expect(
      ocrBlockForHostCapture({
        engine: "vision",
        text: "  ",
        confidence: 1,
        truncated: false,
        metrics: METRICS,
      }),
    ).toBeNull();
  });

  it("drops invalid metrics but keeps the text", async () => {
    host({
      engine: "vision",
      text: "hello",
      confidence: 0.7,
      truncated: false,
      metrics: { ...METRICS, coverage: 3 },
    });
    const frame = await captureThroughHost();
    expect(frame.ok && frame.ocr).toEqual({
      engine: "vision",
      text: "hello",
      confidence: 0.7,
    });
  });
});

describe("the request the page sends", () => {
  const SESSION = "1c2d3e4f-0000-4000-8000-000000000001";
  const sent: FormData[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    sent.push(init?.body as FormData);
    return new Response(
      JSON.stringify({
        input: { requestId: "r", sequence: 1 },
        snapshots: [{ sourceId: "s", eventId: "e" }],
      }),
      { status: 202, headers: { "content-type": "application/json" } },
    );
  };
  const deps = ownerInputDeps(
    "acme",
    fetcher,
    () => ({ actions: [], observations: [] }) as unknown as LiveSnapshot,
  );
  const wire = (form: FormData) =>
    z
      .array(liveOcrBlockSchema.nullable())
      .parse(JSON.parse(String(form.get("ocr"))));
  const block = ocrBlockFor(read());

  it("an Auto capture's ocr entry carries the exact object, metrics included", async () => {
    sent.length = 0;
    await deps.analyzeCapture?.(SESSION, {
      image: new Blob(["x"], { type: "image/jpeg" }),
      label: "Auto",
      ocr: block,
    });
    expect(wire(sent[0] as FormData)).toEqual([
      { engine: "vision", text: "x = 1", confidence: 0.9, metrics: METRICS },
    ]);
  });

  it("an Auto capture with no read sends no ocr field", async () => {
    sent.length = 0;
    await deps.analyzeCapture?.(SESSION, {
      image: new Blob(["x"], { type: "image/jpeg" }),
      label: "Auto",
      ocr: null,
    });
    expect((sent[0] as FormData).has("ocr")).toBe(false);
  });

  it("Apply sends each image's metrics aligned with its image", async () => {
    sent.length = 0;
    await deps.applyContext?.(SESSION, null, {
      requestId: "r-1",
      images: [new Blob(["a"]), new Blob(["b"])],
      ocr: [block, ocrBlockFor(read({ engine: "tesseract" }))],
    });
    expect(wire(sent[0] as FormData)).toEqual([
      { engine: "vision", text: "x = 1", confidence: 0.9, metrics: METRICS },
      { engine: "tesseract", text: "x = 1", confidence: 0.9 },
    ]);
  });
});
