// A capture that cannot run says why and what to do, in the native window: the
// answer pane's banner (and a toast for the person's own press), its action, the
// reason from the shell (including the app in front), a shell that never answers,
// and the banner clearing once a capture works. Through the real page and store.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../../focus-presentation";
import { HOST_CAPTURE_TIMEOUT_MS } from "../../host-adapter";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import {
  installCaptureHost,
  type Journey,
  startJourney,
} from "../../testing/missing-context-kit";
import { minutesAfter } from "../../testing/session-fixtures";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";

let journey: Journey;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const JPEG = btoa("\xff\xd8\xff\xe0JFIF");
const SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

function serve(next: Journey) {
  journey = next;
  configureSessionStores({
    fetch: journey.server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
}
async function open() {
  window.history.replaceState(
    {},
    "",
    "/t/local/p/interview/live/overlay?panel=single&host=native",
  );
  render(<OverlayPage />);
  await flush();
  await flush();
}
// An analysis-free session: the empty answer pane with its capture button.
const capture = async () => {
  fireEvent.click(
    screen.getByRole("button", { name: /Capture screenshot|Analyze screen/ }),
  );
  await flush();
  await flush();
};
const banner = () => screen.queryByTestId("capture-problem");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  window.localStorage.clear();
  window.localStorage.setItem("interview-studio.live.auto.local", "off");
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  serve(startJourney({ first: undefined }));
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete window.studioHost;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the capture button in the empty answer pane", () => {
  it("another app in front, no browser found: says so with the fix, never silence", async () => {
    const captureScreen = installCaptureHost({}, async () => ({
      ok: false,
      reason: "no-focused-window",
      frontApp: "Claude",
    }));
    await open();
    await capture();
    expect(captureScreen).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "explicit" }),
    );
    expect(screen.getByTestId("capture-problem-title")).toHaveTextContent(
      "No browser window found",
    );
    expect(screen.getByTestId("capture-problem-fix")).toHaveTextContent(
      "Open Chrome or Safari, then try again.",
    );
    // The person pressed it: a toast says it too.
    expect(
      screen.getAllByText("No browser window found").length,
    ).toBeGreaterThan(1);
  });

  it("Screen Recording off offers the settings action, which opens the one allowed address", async () => {
    const openExternal = vi.fn(async () => undefined);
    installCaptureHost(
      { capabilities: ["capture-screen", "open-external"], openExternal },
      async () => ({ ok: false, reason: "permission-denied" }),
    );
    await open();
    await capture();
    expect(screen.getByTestId("capture-problem-title")).toHaveTextContent(
      "Screen Recording is off for Interview Studio",
    );
    fireEvent.click(screen.getByTestId("capture-problem-action"));
    expect(openExternal).toHaveBeenCalledWith(SETTINGS);
  });

  it("without an open-external host the fix text stands and there is no button", async () => {
    installCaptureHost({}, async () => ({
      ok: false,
      reason: "permission-denied",
    }));
    await open();
    await capture();
    expect(banner()).not.toBeNull();
    expect(screen.queryByTestId("capture-problem-action")).toBeNull();
  });

  it("a failed capture says it failed and what to check", async () => {
    installCaptureHost({}, async () => ({
      ok: false,
      reason: "capture-failed",
    }));
    await open();
    await capture();
    expect(screen.getByTestId("capture-problem-fix")).toHaveTextContent(
      "check Screen Recording in System Settings",
    );
  });

  it("a busy shell says a capture is already running", async () => {
    installCaptureHost({}, async () => ({ ok: false, reason: "busy" }));
    await open();
    await capture();
    expect(screen.getByTestId("capture-problem-title")).toHaveTextContent(
      "A capture is already running",
    );
  });

  it("a shell that never answers ends 'Capturing the screen' with a banner", async () => {
    installCaptureHost({}, () => new Promise(() => undefined));
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: /Capture screenshot|Analyze screen/ }),
    );
    await flush();
    expect(banner()).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(HOST_CAPTURE_TIMEOUT_MS + 1));
    expect(screen.getByTestId("capture-problem-title")).toHaveTextContent(
      "The shell did not answer",
    );
  });

  it("a bridge that throws is a failure with a banner, not a swallowed rejection", async () => {
    installCaptureHost({}, async () => {
      throw new Error("bridge down");
    });
    await open();
    await capture();
    expect(screen.getByTestId("capture-problem-title")).toHaveTextContent(
      "The capture failed",
    );
  });

  it("the banner stays until dismissed, and goes when a capture works", async () => {
    let working = false;
    installCaptureHost({}, async () =>
      working
        ? { ok: true, mediaType: "image/jpeg", base64: JPEG }
        : { ok: false, reason: "capture-failed" },
    );
    await open();
    await capture();
    expect(banner()).not.toBeNull();
    // Other activity does not clear it.
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(banner()).not.toBeNull();
    working = true;
    await capture();
    expect(banner()).toBeNull();
  });

  it("can be dismissed", async () => {
    installCaptureHost({}, async () => ({
      ok: false,
      reason: "capture-failed",
    }));
    await open();
    await capture();
    fireEvent.click(screen.getByTestId("capture-problem-dismiss"));
    expect(banner()).toBeNull();
  });
});
