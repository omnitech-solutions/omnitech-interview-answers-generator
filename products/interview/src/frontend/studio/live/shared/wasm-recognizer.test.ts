import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWasmRecognizer, type OcrEngine } from "./wasm-recognizer";

const png = () => new Blob(["img"], { type: "image/png" });

function fakeEngine(
  recognize: OcrEngine["recognize"] = async () => ({
    text: "hello world",
    confidence: 91.5,
  }),
) {
  const engine: OcrEngine = {
    recognize: vi.fn(recognize),
    terminate: vi.fn(async () => {}),
  };
  return engine;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("wasm recognizer", () => {
  it("loads the engine lazily, once, and maps the result", async () => {
    const engine = fakeEngine();
    const load = vi.fn(async () => engine);
    const recognizer = createWasmRecognizer({ load, supported: () => true });
    expect(load).not.toHaveBeenCalled();

    const a = await recognizer.recognize(png());
    const b = await recognizer.recognize(png());
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toEqual({
      ok: true,
      engine: "tesseract",
      text: "hello world",
      confidence: 0.915,
      truncated: false,
    });
    expect(b.ok).toBe(true);
  });

  it("serves concurrent callers one at a time from one worker", async () => {
    let running = 0;
    let peak = 0;
    const engine = fakeEngine(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return { text: "t", confidence: 50 };
    });
    const load = vi.fn(async () => engine);
    const recognizer = createWasmRecognizer({ load, supported: () => true });
    const all = Promise.all([
      recognizer.recognize(png()),
      recognizer.recognize(png()),
      recognizer.recognize(png()),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker when idle and loads a fresh one after", async () => {
    const engines = [fakeEngine(), fakeEngine()];
    const load = vi.fn(async () => engines.shift() as OcrEngine);
    const recognizer = createWasmRecognizer({
      load,
      idleMs: 1_000,
      supported: () => true,
    });
    const first = await recognizer.recognize(png());
    expect(first.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    // The one loaded engine was stopped.
    await recognizer.recognize(png());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not terminate while a read is running", async () => {
    const engine = fakeEngine(async () => {
      await new Promise((r) => setTimeout(r, 5_000));
      return { text: "slow", confidence: 80 };
    });
    const recognizer = createWasmRecognizer({
      load: async () => engine,
      idleMs: 1_000,
      budgetMs: 10_000,
      supported: () => true,
    });
    const pending = recognizer.recognize(png());
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(engine.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(engine.terminate).toHaveBeenCalledTimes(1);
  });

  it("times out after the budget and replaces the stuck worker", async () => {
    const stuck = fakeEngine(() => new Promise(() => {}));
    const good = fakeEngine();
    const engines = [stuck, good];
    const load = vi.fn(async () => engines.shift() as OcrEngine);
    const recognizer = createWasmRecognizer({
      load,
      budgetMs: 15_000,
      supported: () => true,
    });
    const pending = recognizer.recognize(png());
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    expect(stuck.terminate).toHaveBeenCalled();
    await expect(recognizer.recognize(png())).resolves.toMatchObject({
      ok: true,
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("aborts a read in flight and one waiting in the queue", async () => {
    const engine = fakeEngine(() => new Promise(() => {}));
    const recognizer = createWasmRecognizer({
      load: async () => engine,
      supported: () => true,
    });
    const first = new AbortController();
    const second = new AbortController();
    const a = recognizer.recognize(png(), first.signal);
    const b = recognizer.recognize(png(), second.signal);
    await vi.advanceTimersByTimeAsync(1);
    first.abort();
    second.abort();
    await expect(a).resolves.toEqual({ ok: false, reason: "aborted" });
    await expect(b).resolves.toEqual({ ok: false, reason: "aborted" });
  });

  it("reports unavailable, visibly and permanently, when the assets fail to load", async () => {
    const load = vi.fn(async (): Promise<OcrEngine> => {
      throw new Error("ocr data missing");
    });
    const recognizer = createWasmRecognizer({ load, supported: () => true });
    expect(recognizer.available).toBe(true);
    await expect(recognizer.recognize(png())).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(recognizer.available).toBe(false);
    await expect(recognizer.recognize(png())).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("is unavailable without WebAssembly and never loads", async () => {
    const load = vi.fn(async () => fakeEngine());
    const recognizer = createWasmRecognizer({ load, supported: () => false });
    expect(recognizer.available).toBe(false);
    await expect(recognizer.recognize(png())).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("guards type and size, and calls an engine error unreadable", async () => {
    const engine = fakeEngine(async () => {
      throw new Error("bad image");
    });
    const load = vi.fn(async () => engine);
    const recognizer = createWasmRecognizer({ load, supported: () => true });
    await expect(
      recognizer.recognize(new Blob(["x"], { type: "text/plain" })),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });
    expect(load).not.toHaveBeenCalled();
    await expect(recognizer.recognize(png())).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(recognizer.available).toBe(true);
  });

  it("cuts very long text at a line and says so", async () => {
    const long = `${"z".repeat(99)}\n`.repeat(400);
    const recognizer = createWasmRecognizer({
      load: async () =>
        fakeEngine(async () => ({ text: long, confidence: 70 })),
      supported: () => true,
    });
    const result = await recognizer.recognize(png());
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.text.length).toBeLessThanOrEqual(20_000);
  });
});
