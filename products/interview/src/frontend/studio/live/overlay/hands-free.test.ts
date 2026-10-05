// "Start hands-free" must not raise the web view's own microphone prompt when a
// native shell's engine owns the microphone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handsFreeSummary, prepareHandsFree } from "./hands-free";

const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
afterEach(() => {
  getUserMedia.mockClear();
  delete (window as { studioHost?: unknown }).studioHost;
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const withMedia = () =>
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });

describe("prepareHandsFree microphone", () => {
  it("native engine present: no getUserMedia, and the summary names no gap", async () => {
    withMedia();
    const noop = async () => ({ ok: true }) as never;
    (window as { studioHost?: unknown }).studioHost = {
      engine: {
        start: noop,
        stop: noop,
        pause: noop,
        resume: noop,
        status: noop,
        onEvent: () => () => undefined,
      },
    };
    const outcome = await prepareHandsFree({ deviceOnly: true });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(outcome.mic).toBe("engine");
    expect(handsFreeSummary(outcome)).toBe("Hands-free is on.");
  });

  it("web host: the page asks for the microphone as before", async () => {
    withMedia();
    const outcome = await prepareHandsFree({ deviceOnly: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(outcome.mic).toBe("allowed");
  });
});
