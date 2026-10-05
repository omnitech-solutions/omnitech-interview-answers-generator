import type { StudioHost } from "@omnitech/interview-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeRecognizer,
  NATIVE_OCR_MAX_BYTES,
} from "./native-recognizer";

const png = (bytes = "hello") => new Blob([bytes], { type: "image/png" });
const hostReplying = (reply: unknown) => {
  const recognizeText = vi.fn(async () => reply);
  return {
    host: { recognizeText } as unknown as Pick<StudioHost, "recognizeText">,
    recognizeText,
  };
};

describe("native recognizer", () => {
  it("sends the image's type and base64 bytes and maps the reply", async () => {
    const { host, recognizeText } = hostReplying({
      ok: true,
      engine: "vision",
      text: "x = 1",
      confidence: 0.8,
      truncated: true,
    });
    const result = await createNativeRecognizer(host).recognize(png("hello"));
    expect(recognizeText).toHaveBeenCalledWith({
      mediaType: "image/png",
      base64: btoa("hello"),
    });
    expect(result).toEqual({
      ok: true,
      engine: "vision",
      text: "x = 1",
      confidence: 0.8,
      truncated: true,
    });
  });

  it.each(["too-large", "unreadable", "timeout", "unavailable"] as const)(
    "passes the host's refusal %s through",
    async (reason) => {
      const { host } = hostReplying({ ok: false, reason });
      await expect(
        createNativeRecognizer(host).recognize(png()),
      ).resolves.toEqual({ ok: false, reason });
    },
  );

  it("reads an unknown refusal or shape as unavailable", async () => {
    const odd = hostReplying({ ok: false, reason: "weird" });
    await expect(
      createNativeRecognizer(odd.host).recognize(png()),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
    const bad = hostReplying(undefined);
    await expect(
      createNativeRecognizer(bad.host).recognize(png()),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("turns a throwing host into unavailable", async () => {
    const host = {
      recognizeText: vi.fn(async () => {
        throw new Error("bridge gone");
      }),
    } as unknown as Pick<StudioHost, "recognizeText">;
    await expect(
      createNativeRecognizer(host).recognize(png()),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("guards type and size before crossing the bridge", async () => {
    const { host, recognizeText } = hostReplying({ ok: true });
    const recognizer = createNativeRecognizer(host);
    await expect(
      recognizer.recognize(new Blob(["x"], { type: "image/gif" })),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });
    await expect(
      recognizer.recognize(new Blob([], { type: "image/png" })),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });
    await expect(
      recognizer.recognize(
        new Blob([new Uint8Array(NATIVE_OCR_MAX_BYTES + 1)], {
          type: "image/jpeg",
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: "too-large" });
    expect(recognizeText).not.toHaveBeenCalled();
  });

  it("is aborted before and during the call", async () => {
    const { host, recognizeText } = hostReplying({ ok: true });
    const done = new AbortController();
    done.abort();
    await expect(
      createNativeRecognizer(host).recognize(png(), done.signal),
    ).resolves.toEqual({ ok: false, reason: "aborted" });
    expect(recognizeText).not.toHaveBeenCalled();

    const slow = {
      recognizeText: vi.fn(() => new Promise(() => {})),
    } as unknown as Pick<StudioHost, "recognizeText">;
    const live = new AbortController();
    const pending = createNativeRecognizer(slow).recognize(png(), live.signal);
    await vi.waitFor(() => expect(slow.recognizeText).toHaveBeenCalled());
    live.abort();
    await expect(pending).resolves.toEqual({ ok: false, reason: "aborted" });
  });

  it("is unavailable when the host has no recognizeText", async () => {
    const recognizer = createNativeRecognizer({});
    expect(recognizer.available).toBe(false);
    await expect(recognizer.recognize(png())).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
