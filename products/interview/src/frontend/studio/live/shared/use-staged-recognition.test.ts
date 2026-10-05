import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  NO_RECOGNIZER,
  type RecognitionResult,
  type TextRecognizer,
} from "./text-recognizer";
import {
  recognitionFromResult,
  type StagedImage,
  summarizeRecognition,
  useStagedRecognition,
} from "./use-staged-recognition";

const blob = (name: string) => new Blob([name], { type: "image/png" });
const image = (id: string, name = id): StagedImage => ({
  id,
  blob: blob(name),
});

// A recognizer whose answers the test releases by hand; it records signals.
function manualRecognizer() {
  const calls: {
    blob: Blob;
    signal: AbortSignal | undefined;
    settle: (result: RecognitionResult) => void;
  }[] = [];
  const recognizer: TextRecognizer = {
    engine: "vision",
    available: true,
    recognize: (b, signal) =>
      new Promise((resolve) => {
        calls.push({ blob: b, signal, settle: resolve });
      }),
  };
  return { recognizer, calls };
}
const text = (value: string): RecognitionResult => ({
  ok: true,
  engine: "vision",
  text: value,
  confidence: 0.9,
  truncated: false,
});

describe("recognitionFromResult", () => {
  it("maps results to the tray's states", () => {
    expect(recognitionFromResult(text("a"))).toEqual({
      status: "done",
      block: { engine: "vision", text: "a", confidence: 0.9 },
    });
    expect(recognitionFromResult(text("  "))).toEqual({
      status: "done",
      block: null,
    });
    expect(recognitionFromResult({ ok: false, reason: "timeout" })).toEqual({
      status: "failed",
      reason: "timeout",
    });
    expect(recognitionFromResult({ ok: false, reason: "unavailable" })).toEqual(
      { status: "unavailable" },
    );
  });
});

describe("summarizeRecognition", () => {
  it("aligns ocr with the image order and flags pending", () => {
    const [a, b, c] = [image("a"), image("b"), image("c")] as [
      StagedImage,
      StagedImage,
      StagedImage,
    ];
    const summary = summarizeRecognition([a, b, c], (blobKey) =>
      blobKey === a.blob
        ? recognitionFromResult(text("A"))
        : blobKey === b.blob
          ? { status: "pending" }
          : { status: "unavailable" },
    );
    expect(summary.ocr).toEqual([
      { engine: "vision", text: "A", confidence: 0.9 },
      null,
      null,
    ]);
    expect(summary.pending).toBe(true);
    expect([...summary.states.keys()]).toEqual(["a", "b", "c"]);
  });
});

describe("useStagedRecognition", () => {
  it("recognises on stage and exposes the result", async () => {
    const { recognizer, calls } = manualRecognizer();
    const images = [image("a")];
    const { result } = renderHook(() =>
      useStagedRecognition(images, recognizer),
    );
    expect(result.current.states.get("a")).toEqual({ status: "pending" });
    expect(result.current.pending).toBe(true);
    expect(calls).toHaveLength(1);

    act(() => calls[0]?.settle(text("hello")));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.states.get("a")).toMatchObject({ status: "done" });
    expect(result.current.ocr).toEqual([
      { engine: "vision", text: "hello", confidence: 0.9 },
    ]);
  });

  it("does not read the same blob twice across re-renders", async () => {
    const { recognizer, calls } = manualRecognizer();
    const staged = image("a");
    const { rerender } = renderHook(
      ({ images }) => useStagedRecognition(images, recognizer),
      { initialProps: { images: [staged] } },
    );
    rerender({ images: [staged, image("b")] });
    rerender({ images: [staged, image("b")] });
    // a once; b twice only because each render built a new b blob.
    expect(calls.filter((c) => c.blob === staged.blob)).toHaveLength(1);
  });

  it("re-recognises after a crop changes the blob and drops the old read", async () => {
    const { recognizer, calls } = manualRecognizer();
    const original = image("a", "full");
    const { result, rerender } = renderHook(
      ({ images }) => useStagedRecognition(images, recognizer),
      { initialProps: { images: [original] } },
    );
    act(() => calls[0]?.settle(text("full text")));
    await waitFor(() => expect(result.current.pending).toBe(false));

    const cropped: StagedImage = { id: "a", blob: blob("cropped") };
    rerender({ images: [cropped] });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.blob).toBe(cropped.blob);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(result.current.states.get("a")).toEqual({ status: "pending" });
    expect(result.current.ocr).toEqual([null]);

    act(() => calls[1]?.settle(text("crop text")));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.ocr[0]?.text).toBe("crop text");
  });

  it("ignores a late answer for a replaced blob", async () => {
    const { recognizer, calls } = manualRecognizer();
    const { result, rerender } = renderHook(
      ({ images }) => useStagedRecognition(images, recognizer),
      { initialProps: { images: [image("a", "one")] } },
    );
    rerender({ images: [image("a", "two")] });
    act(() => calls[0]?.settle(text("stale")));
    act(() => calls[1]?.settle(text("fresh")));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.ocr[0]?.text).toBe("fresh");
  });

  it("unstaging aborts the read; unmounting aborts the rest", () => {
    const { recognizer, calls } = manualRecognizer();
    const a = image("a");
    const b = image("b");
    const { rerender, unmount } = renderHook(
      ({ images }) => useStagedRecognition(images, recognizer),
      { initialProps: { images: [a, b] } },
    );
    expect(calls).toHaveLength(2);
    rerender({ images: [b] });
    expect(calls.find((c) => c.blob === a.blob)?.signal?.aborted).toBe(true);
    expect(calls.find((c) => c.blob === b.blob)?.signal?.aborted).toBe(false);
    unmount();
    expect(calls.find((c) => c.blob === b.blob)?.signal?.aborted).toBe(true);
  });

  it("keeps the order of the images, whichever read finishes first", async () => {
    const { recognizer, calls } = manualRecognizer();
    const images = [image("a"), image("b"), image("c")];
    const { result } = renderHook(() =>
      useStagedRecognition(images, recognizer),
    );
    act(() => calls[2]?.settle(text("third")));
    act(() => calls[0]?.settle(text("first")));
    act(() => calls[1]?.settle({ ok: false, reason: "unreadable" }));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.ocr.map((b) => b?.text ?? null)).toEqual([
      "first",
      null,
      "third",
    ]);
    expect(result.current.states.get("b")).toEqual({
      status: "failed",
      reason: "unreadable",
    });
  });

  it("is unavailable, visibly, without a recognizer, and reads nothing", () => {
    const spy = vi.spyOn(NO_RECOGNIZER, "recognize");
    const images = [image("a")];
    const { result } = renderHook(() =>
      useStagedRecognition(images, NO_RECOGNIZER),
    );
    expect(result.current.states.get("a")).toEqual({ status: "unavailable" });
    expect(result.current.pending).toBe(false);
    expect(result.current.ocr).toEqual([null]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps an engine that answers unavailable at read time", async () => {
    const recognizer: TextRecognizer = {
      engine: "tesseract",
      available: true,
      recognize: async () => ({ ok: false, reason: "unavailable" }),
    };
    const images = [image("a")];
    const { result } = renderHook(() =>
      useStagedRecognition(images, recognizer),
    );
    await waitFor(() =>
      expect(result.current.states.get("a")).toEqual({
        status: "unavailable",
      }),
    );
  });
});
