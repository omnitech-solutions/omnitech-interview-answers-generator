import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_STAGED_IMAGES, OCR_WAIT_MS } from "./screenshot-tray";
import type { RecognitionResult, TextRecognizer } from "./text-recognizer";
import { type GrabbedFrame, useScreenshotTray } from "./use-screenshot-tray";

const frame = (name: string): GrabbedFrame => ({
  blob: new Blob([name], { type: "image/png" }),
  label: "This Mac",
  display: { name: "Studio Display", index: 2, count: 3 },
});
const text = (value: string): RecognitionResult => ({
  ok: true,
  engine: "vision",
  text: value,
  confidence: 0.9,
  truncated: false,
});

// A recognizer whose answers the test releases by hand.
function manualRecognizer() {
  const calls: { blob: Blob; settle(result: RecognitionResult): void }[] = [];
  const recognizer: TextRecognizer = {
    engine: "vision",
    available: true,
    recognize: (blob) =>
      new Promise((settle) => {
        calls.push({ blob, settle });
      }),
  };
  return { recognizer, calls };
}
const instantRecognizer = (value = "hello"): TextRecognizer => ({
  engine: "vision",
  available: true,
  recognize: async () => text(value),
});

const TARGET = { taskId: "t1", revision: 2 };
function setup(
  over: {
    recognizer?: TextRecognizer;
    applyContext?: ReturnType<typeof vi.fn>;
    target?: typeof TARGET | null;
    deviceOnly?: boolean;
    sessionId?: string;
  } = {},
) {
  const applyContext = over.applyContext ?? vi.fn(async () => ({ ok: true }));
  // One recognizer for the life of the hook: a new one resets every read.
  const recognizer = over.recognizer ?? instantRecognizer();
  const view = renderHook(
    (props: { sessionId: string; target?: typeof TARGET | null }) =>
      useScreenshotTray({
        actions: { applyContext } as never,
        sessionId: props.sessionId,
        target:
          props.target !== undefined
            ? props.target
            : over.target === undefined
              ? TARGET
              : over.target,
        deviceOnly: over.deviceOnly ?? false,
        hints: { skill: "auto" },
        mode: "manual",
        recognizer,
      }),
    {
      initialProps: { sessionId: over.sessionId ?? "s1" } as {
        sessionId: string;
        target?: typeof TARGET | null;
      },
    },
  );
  return { ...view, applyContext };
}

afterEach(() => vi.useRealTimers());
// Instant text reads settle in a microtask; let them land before Apply, so the
// test is not waiting inside an `act` scope that holds React's updates back.
const settled = async (apply: () => Promise<unknown>) => {
  await flush();
  await act(async () => {
    await apply();
  });
};
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe("Apply", () => {
  it("sends every staged image in tray order, with its text and display, as ONE request", async () => {
    const { result, applyContext } = setup();
    act(() => {
      result.current.stage(frame("a"), "add");
      result.current.stage(frame("b"));
      result.current.stage(frame("c"));
    });
    act(() => result.current.move(result.current.items[2]?.id ?? "", -1));
    const order = result.current.items.map((item) => item.blob);
    await flush();
    await settled(() => result.current.apply());
    expect(applyContext).toHaveBeenCalledTimes(1);
    const [target, input] = applyContext.mock.calls[0] as unknown as [
      unknown,
      { images: Blob[]; ocr: unknown[]; display: unknown[]; requestId: string },
    ];
    expect(target).toEqual(TARGET);
    expect(input.images).toEqual(order);
    expect(input.ocr).toHaveLength(3);
    expect(input.ocr[0]).toMatchObject({ engine: "vision", text: "hello" });
    expect(input.display).toEqual(
      Array.from({ length: 3 }, () => ({
        name: "Studio Display",
        index: 2,
        count: 3,
      })),
    );
    expect(result.current.items).toHaveLength(0);
  });

  it("a new problem sends no target; with no task it is always new", async () => {
    const { result, applyContext } = setup({ target: null });
    act(() => {
      result.current.stage(frame("a"));
    });
    await settled(() => result.current.apply());
    expect(applyContext.mock.calls[0]?.[0]).toBeNull();

    const chosen = setup();
    act(() => {
      chosen.result.current.stage(frame("a"), "new");
    });
    await settled(() => chosen.result.current.apply());
    expect(chosen.applyContext.mock.calls[0]?.[0]).toBeNull();
  });

  it("forces a plain regenerate with nothing staged when targeting a task: zero images", async () => {
    const { result, applyContext } = setup();
    expect(result.current.canApply).toBe(true);
    await settled(() => result.current.apply());
    expect(applyContext).toHaveBeenCalledTimes(1);
    expect(applyContext.mock.calls[0]?.[0]).toEqual(TARGET);
    expect(
      (applyContext.mock.calls[0]![1] as { images: Blob[] }).images,
    ).toEqual([]);
  });

  it("is one request however many times it is pressed", async () => {
    let release: (value: { ok: true }) => void = () => undefined;
    const applyContext = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => (release = resolve)),
    );
    const { result } = setup({ applyContext });
    act(() => {
      result.current.stage(frame("a"));
    });
    await flush();
    act(() => {
      void result.current.apply();
      void result.current.apply();
    });
    await flush();
    expect(applyContext).toHaveBeenCalledTimes(1);
    expect(result.current.applying).toBe(true);
    await act(async () => release({ ok: true }));
    expect(result.current.applying).toBe(false);
  });

  it("reuses ONE request id for a retry, and a new one after an edit", async () => {
    const applyContext = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "network" })
      .mockResolvedValueOnce({ ok: false, code: "network" })
      .mockResolvedValue({ ok: true });
    const { result } = setup({ applyContext });
    act(() => {
      result.current.stage(frame("a"));
    });
    await settled(() => result.current.apply());
    expect(result.current.failure).toBe("request");
    await settled(() => result.current.apply());
    const ids = applyContext.mock.calls.map(
      (call) => (call[1] as { requestId: string }).requestId,
    );
    expect(ids[0]).toBe(ids[1]);
    expect(result.current.items).toHaveLength(1);
    act(() => {
      result.current.stage(frame("b"));
    });
    await settled(() => result.current.apply());
    expect(
      (applyContext.mock.calls[2]![1] as { requestId: string }).requestId,
    ).not.toBe(ids[0]);
  });

  it.each([
    ["stale_target"],
    ["vision_device_only"],
    ["image_count"],
    ["image_too_large"],
    ["image_dimensions"],
    ["image_type"],
    ["ocr"],
  ])("keeps the images and names the refusal %s", async (reason) => {
    const applyContext = vi.fn(async () => ({
      ok: false,
      code: "invalid_input",
      reason,
    }));
    const { result } = setup({ applyContext });
    act(() => {
      result.current.stage(frame("a"));
    });
    await settled(() => result.current.apply());
    expect(result.current.failure).toBe(reason);
    expect(result.current.failureText).toBeTruthy();
    expect(result.current.items).toHaveLength(1);
  });
});

describe("text before the model", () => {
  it("says Reading text while an image is unread, waits, and sends the text once it arrives", async () => {
    const { recognizer, calls } = manualRecognizer();
    const { result, applyContext } = setup({ recognizer });
    act(() => {
      result.current.stage(frame("a"));
    });
    expect(result.current.recognition.pending).toBe(true);
    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => {
      sent = result.current.apply();
    });
    expect(result.current.reading).toBe(true);
    expect(applyContext).not.toHaveBeenCalled();
    await act(async () => {
      calls[0]?.settle(text("read it"));
    });
    await sent;
    const input = applyContext.mock.calls[0]?.[1] as { ocr: unknown[] };
    expect(input.ocr[0]).toMatchObject({ text: "read it" });
  });

  it(`sends without the text after ${OCR_WAIT_MS} ms of waiting`, async () => {
    const { recognizer } = manualRecognizer();
    const { result, applyContext } = setup({ recognizer });
    act(() => {
      result.current.stage(frame("a"));
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      void result.current.apply();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OCR_WAIT_MS);
    });
    expect(applyContext).toHaveBeenCalledTimes(1);
    expect((applyContext.mock.calls[0]![1] as { ocr: unknown[] }).ocr).toEqual([
      null,
    ]);
  });

  it("re-reads a cropped image: the new blob is recognised and the old read is dropped", async () => {
    const { recognizer, calls } = manualRecognizer();
    const { result } = setup({ recognizer });
    act(() => {
      result.current.stage(frame("a"));
    });
    expect(calls).toHaveLength(1);
    const cropped = new Blob(["cropped"], { type: "image/png" });
    act(() => result.current.crop(result.current.items[0]?.id ?? "", cropped));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.blob).toBe(cropped);
  });
});

describe("a changed session, a frozen request", () => {
  it("a session change while text is read sends nothing, empties the tray and leaves it usable", async () => {
    const { recognizer } = manualRecognizer();
    const { result, rerender, applyContext } = setup({ recognizer });
    act(() => {
      result.current.stage(frame("a"));
    });
    let sent: Promise<boolean> = Promise.resolve(true);
    act(() => {
      sent = result.current.apply();
    });
    expect(result.current.applying).toBe(true);
    rerender({ sessionId: "s2" });
    await act(async () => {
      expect(await sent).toBe(false);
    });
    expect(applyContext).not.toHaveBeenCalled();
    expect(result.current.applying).toBe(false);
    expect(result.current.items).toHaveLength(0);
    act(() => {
      result.current.stage(frame("b"));
    });
    expect(result.current.items).toHaveLength(1);
  });

  it("a session change while the request is out never leaves the tray applying", async () => {
    let release: (value: { ok: true }) => void = () => undefined;
    const applyContext = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => (release = resolve)),
    );
    const { result, rerender } = setup({ applyContext });
    act(() => {
      result.current.stage(frame("a"));
    });
    await flush();
    act(() => {
      void result.current.apply();
    });
    await flush();
    rerender({ sessionId: "s2" });
    expect(result.current.applying).toBe(false);
    await act(async () => release({ ok: true }));
    expect(result.current.applying).toBe(false);
  });

  it("Retry resends the first request verbatim: same id, same text, same task", async () => {
    const { recognizer, calls } = manualRecognizer();
    const applyContext = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "network" })
      .mockResolvedValue({ ok: true });
    const { result, rerender } = setup({ recognizer, applyContext });
    act(() => {
      result.current.stage(frame("a"), "add");
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      void result.current.apply();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OCR_WAIT_MS);
    });
    vi.useRealTimers();
    expect(result.current.failure).toBe("request");
    // The text arrives late and another task is selected before Retry.
    await act(async () => {
      calls[0]?.settle(text("late"));
    });
    rerender({ sessionId: "s1", target: { taskId: "t9", revision: 1 } });
    await settled(() => result.current.apply());
    const [firstTarget, first] = applyContext.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    const [retryTarget, retry] = applyContext.mock.calls[1] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(retry).toEqual(first);
    expect(first["ocr"]).toEqual([null]);
    expect(retryTarget).toEqual(firstTarget);
    expect(firstTarget).toEqual(TARGET);
  });

  it("the person's task is frozen at Apply: selecting another while text is read does not redirect it", async () => {
    const { recognizer, calls } = manualRecognizer();
    const { result, rerender, applyContext } = setup({ recognizer });
    act(() => {
      result.current.stage(frame("a"), "add");
    });
    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => {
      sent = result.current.apply();
    });
    rerender({ sessionId: "s1", target: null });
    await act(async () => {
      calls[0]?.settle(text("x"));
    });
    await sent;
    expect(applyContext.mock.calls[0]?.[0]).toEqual(TARGET);
  });

  it("a refusal makes the next Apply a new request id", async () => {
    const applyContext = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: "invalid_input",
        reason: "stale_target",
      })
      .mockResolvedValue({ ok: true });
    const { result } = setup({ applyContext });
    act(() => {
      result.current.stage(frame("a"));
    });
    await settled(() => result.current.apply());
    await settled(() => result.current.apply());
    const ids = applyContext.mock.calls.map(
      (call) => (call[1] as { requestId: string }).requestId,
    );
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("stage reports false with a reason while Apply is running, and the frame is not kept", async () => {
    let release: (value: { ok: true }) => void = () => undefined;
    const applyContext = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => (release = resolve)),
    );
    const { result } = setup({ applyContext });
    act(() => {
      result.current.stage(frame("a"));
    });
    await flush();
    act(() => {
      void result.current.apply();
    });
    await flush();
    let added = true;
    act(() => {
      added = result.current.stage(frame("b"));
    });
    expect(added).toBe(false);
    expect(result.current.stageRefusal()).toBe("Sending the screenshots now.");
    await act(async () => release({ ok: true }));
    expect(result.current.stageRefusal()).toBeNull();
  });
});

describe("limits and guards", () => {
  it("stops at the image maximum and says so", () => {
    const { result } = setup();
    act(() => {
      for (let n = 0; n <= MAX_STAGED_IMAGES; n += 1)
        result.current.stage(frame(`s${n}`));
    });
    expect(result.current.items).toHaveLength(MAX_STAGED_IMAGES);
    expect(result.current.canAdd).toBe(false);
    expect(result.current.addDisabledReason).toMatch(/At most 4/);
  });

  it("disables Add with the device-only reason before anything is added, and refuses Apply with images", () => {
    const { result } = setup({ deviceOnly: true });
    expect(result.current.canAdd).toBe(false);
    expect(result.current.addDisabledReason).toMatch(
      /never sends a screenshot/,
    );
    expect(result.current.sends).toMatch(/no screenshot leaves this device/);
  });

  it("an empty tray for another session", () => {
    const { result, rerender } = setup();
    act(() => {
      result.current.stage(frame("a"));
    });
    rerender({ sessionId: "s2" });
    expect(result.current.items).toHaveLength(0);
  });

  it("registers the screens that draw the tray", () => {
    const { result } = setup();
    expect(result.current.hasSurface()).toBe(false);
    let detach = () => {};
    act(() => {
      detach = result.current.attach();
    });
    expect(result.current.hasSurface()).toBe(true);
    detach();
    expect(result.current.hasSurface()).toBe(false);
  });
});
