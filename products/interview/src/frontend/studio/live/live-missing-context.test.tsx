// The missing-context journey on the web live page, through the real page, the
// hands-free band, the real store and the real routes' wire shapes (a fake
// server: no model): the strip beside the task, "Add context" focusing the
// follow-up box, "Add another screenshot" aimed at the task on show, one request
// per press, dismissal across a reload, and capture failures that stay notes.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "./focus-presentation";
import { LiveSessionView } from "./live-view";
import { installDisplayMedia } from "./overlay/capture-fixtures";
import { HandsFreeProvider } from "./overlay/hands-free-context";
import { configureSessionStores, resetSessionStores } from "./session-registry";
import {
  CUT_OFF_TASK,
  installCaptureHost,
  type Journey,
  startJourney,
} from "./testing/missing-context-kit";
import { minutesAfter } from "./testing/session-fixtures";

const studio = {} as never;
let journey: Journey;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const strip = () => screen.queryByTestId("missing-context");
const input = () => screen.getByLabelText("Follow-up");
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = async (name: string | RegExp) => {
  fireEvent.click(button(name));
  await flush();
};
const alerts = () =>
  screen
    .queryAllByRole("alert")
    .map((each) => each.textContent)
    .join(" | ");

function serve(next: Journey = journey) {
  journey = next;
  configureSessionStores({
    fetch: journey.server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
}
async function open(provider = true) {
  const page = <LiveSessionView rest={[]} studio={studio} />;
  const view = render(
    provider ? <HandsFreeProvider>{page}</HandsFreeProvider> : page,
  );
  await flush();
  await flush();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  // Hands-free Auto would capture on its own in a native host.
  window.localStorage.setItem("interview-studio.live.auto.local", "off");
  resetSessionStores();
  presentation.reset();
  serve(startJourney());
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  delete window.studioHost;
  installDisplayMedia(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the strip beside the task", () => {
  it("says what the AI may be missing, with the three ways to answer it", async () => {
    await open();
    const note = strip() as HTMLElement;
    expect(note).toHaveClass("live-missing");
    expect(screen.getByTestId("task-panel")).toContainElement(note);
    expect(note).toHaveTextContent("The AI may be missing:");
    expect(note).toHaveTextContent("Examples");
    expect(note).toHaveTextContent(
      "The rest of the problem (it looks cut off): the bottom of the page is hidden",
    );
    for (const name of [
      "Add another screenshot",
      "Add context",
      "Looks complete",
    ])
      expect(button(name)).toBeEnabled();
  });

  it("has no strip when nothing is reported missing", async () => {
    serve(startJourney({ first: undefined }));
    await open();
    expect(strip()).toBeNull();
  });
});

describe("Add context", () => {
  it("focuses the follow-up box; the typed text revises the task and the strip clears", async () => {
    await open();
    await press("Add context");
    expect(input()).toHaveFocus();
    fireEvent.change(input(), { target: { value: " the examples " } });
    await press("Send follow-up");
    expect(journey.inputs).toHaveLength(1);
    expect(journey.inputs[0]).toMatchObject({
      operation: "follow-up",
      text: "the examples",
      target: { taskId: CUT_OFF_TASK, revision: 1 },
    });
    await advance(1_500);
    expect(strip()).toBeNull();
    expect(screen.getByTestId("task-panel")).toHaveTextContent(
      "Revised with the added context.",
    );
    expect(screen.getByTestId("task-panel")).toHaveTextContent("T1 · rev 2");
  });

  it("opens the collapsed controls first, then focuses the box", async () => {
    await open();
    await press("Collapse hands-free");
    expect(screen.queryByLabelText("Follow-up")).toBeNull();
    await press("Add context");
    expect(input()).toHaveFocus();
  });

  it("aims the follow-up at the task chosen on the page, not the newest", async () => {
    journey.publish(
      journey.revision(
        { taskId: "task-newer", revision: 1 },
        { draft: "A newer task." },
      ),
    );
    serve(journey);
    await open();
    expect(strip()).toBeNull();
    await press(/^T1 · /);
    expect(strip()).toBeVisible();
    await press("Add context");
    fireEvent.change(input(), { target: { value: "constraints" } });
    await press("Send follow-up");
    expect(journey.inputs[0]).toMatchObject({
      target: { taskId: CUT_OFF_TASK, revision: 1 },
    });
  });

  it("makes one request for a double submit", async () => {
    await open();
    fireEvent.change(input(), { target: { value: "the examples" } });
    const form = input().closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await flush();
    expect(journey.inputs).toHaveLength(1);
  });

  it("sends nothing for blank text", async () => {
    await open();
    fireEvent.change(input(), { target: { value: "   " } });
    expect(button("Send follow-up")).toBeDisabled();
    fireEvent.submit(input().closest("form") as HTMLFormElement);
    await flush();
    expect(journey.inputs).toEqual([]);
  });
});

describe("Add another screenshot", () => {
  it("stages the capture on the device; Apply sends it for the task on show and the revision clears the strip", async () => {
    installCaptureHost();
    await open();
    await press("Add another screenshot");
    await flush();
    // Manual stages: nothing is sent until Apply.
    expect(journey.captures).toHaveLength(0);
    expect(screen.getByTestId("staged-1")).toHaveTextContent("Not sent yet");
    fireEvent.click(screen.getByTestId("apply-screenshots"));
    await flush();
    expect(journey.captures).toHaveLength(1);
    expect(journey.captures[0]).toMatchObject({
      operation: "analyze",
      targetTaskId: CUT_OFF_TASK,
      targetRevision: "1",
    });
    await advance(1_500);
    expect(strip()).toBeNull();
    expect(screen.getByTestId("task-panel")).toHaveTextContent("T1 · rev 2");
  });

  it("makes one request for a double press", async () => {
    let release: (value: unknown) => void = () => undefined;
    const host = installCaptureHost(
      {},
      () => new Promise((resolve) => (release = resolve)),
    );
    await open();
    fireEvent.click(button("Add another screenshot"));
    fireEvent.click(button("Add another screenshot"));
    await flush();
    release({
      ok: true,
      mediaType: "image/jpeg",
      base64: btoa("\xff\xd8\xff\xe0JFIF"),
    });
    await flush();
    await flush();
    expect(host).toHaveBeenCalledTimes(1);
    // One staged image; a double Apply is one request.
    expect(journey.captures).toHaveLength(0);
    fireEvent.click(screen.getByTestId("apply-screenshots"));
    fireEvent.click(screen.getByTestId("apply-screenshots"));
    await flush();
    await flush();
    expect(journey.captures).toHaveLength(1);
  });

  it("says so, and leaves the strip, when the person shares nothing", async () => {
    installDisplayMedia(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );
    await open();
    await press("Add another screenshot");
    await flush();
    expect(screen.getByTestId("capture-problem")).toHaveAttribute(
      "data-reason",
      "share-cancelled",
    );
    expect(journey.captures).toEqual([]);
    expect(strip()).toHaveTextContent("Examples");
  });

  it("a failed host capture is a note and does not touch the strip", async () => {
    installCaptureHost({}, async () => ({
      ok: false,
      reason: "permission-denied",
    }));
    await open();
    await press("Add another screenshot");
    await flush();
    expect(alerts()).toContain("Screen Recording is off for Interview Studio");
    expect(journey.captures).toEqual([]);
    expect(strip()).toHaveTextContent("Examples");
  });

  it("a capture problem is a banner with the fix and its action, until the next capture works", async () => {
    const openExternal = vi.fn(async () => undefined);
    let working = false;
    const captureScreen = installCaptureHost(
      {
        capabilities: ["capture-screen", "open-external"],
        openExternal,
      },
      async () =>
        working
          ? {
              ok: true,
              mediaType: "image/jpeg",
              base64: btoa("\xff\xd8\xff\xe0JFIF"),
            }
          : { ok: false, reason: "permission-denied" },
    );
    await open();
    await press("Add another screenshot");
    await flush();
    const banner = screen.getByTestId("capture-problem");
    expect(banner).toHaveAttribute("data-reason", "permission-denied");
    expect(screen.getByTestId("capture-problem-fix")).toHaveTextContent(
      "Screen & System Audio Recording",
    );
    // Add another screenshot is the person's own press: an explicit capture.
    expect(captureScreen).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "explicit" }),
    );
    fireEvent.click(screen.getByTestId("capture-problem-action"));
    expect(openExternal).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
    // It stays through other work, and goes when a capture succeeds.
    await press("Add another screenshot");
    await flush();
    expect(screen.getByTestId("capture-problem")).toBeVisible();
    working = true;
    await press("Add another screenshot");
    await flush();
    expect(screen.queryByTestId("capture-problem")).toBeNull();
  });

  it("a capture problem can be dismissed", async () => {
    installCaptureHost({}, async () => ({
      ok: false,
      reason: "capture-failed",
    }));
    await open();
    await press("Add another screenshot");
    await flush();
    expect(screen.getByTestId("capture-problem-title")).toHaveTextContent(
      "The capture failed",
    );
    fireEvent.click(screen.getByTestId("capture-problem-dismiss"));
    expect(screen.queryByTestId("capture-problem")).toBeNull();
  });

  it("is unavailable, with the reason, in a device-only session", async () => {
    serve(startJourney({ session: { processingPolicy: "device-only" } }));
    installCaptureHost();
    await open();
    expect(button("Add another screenshot")).toBeDisabled();
    expect(
      screen.getByTestId("missing-screenshot-unavailable"),
    ).toHaveTextContent(
      "Device-only mode never sends a screenshot to an assistant.",
    );
    expect(button("Add context")).toBeEnabled();
  });

  it("is unavailable, with the reason, where the page has no capture controls", async () => {
    await open(false);
    expect(button("Add another screenshot")).toBeDisabled();
    expect(
      screen.getByTestId("missing-screenshot-unavailable"),
    ).toHaveTextContent("Capture is not available on this page.");
  });
});

describe("Looks complete", () => {
  it("hides the strip for this revision, across a reload, until a newer revision asks again", async () => {
    const view = await open();
    await press("Looks complete");
    expect(strip()).toBeNull();
    view.unmount();
    resetSessionStores();
    presentation.reset();
    serve(journey);
    await open();
    expect(strip()).toBeNull();
    journey.nextMissing = [{ kind: "language" }];
    fireEvent.change(input(), { target: { value: "python" } });
    await press("Send follow-up");
    await advance(1_500);
    expect(strip()).toHaveTextContent("Target language");
  });

  it("restores the strip for the current revision after a reload", async () => {
    const view = await open();
    view.unmount();
    resetSessionStores();
    serve(journey);
    await open();
    expect(strip()).toHaveTextContent("Examples");
  });
});
