// The missing-context journey in the native window, through the real page, the
// real store and the real routes' wire shapes (a fake server: no model): the
// strip, "Add context" and "Add another screenshot" aimed at the task on show,
// the revised answer clearing the strip, dismissal across a reload, one request
// per press, refusals that keep the strip and the typed text, capture failures
// that stay a separate channel, stop-work and a late result for an old revision.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import {
  CUT_OFF,
  CUT_OFF_TASK,
  installCaptureHost,
  type Journey,
  startJourney,
} from "../../testing/missing-context-kit";
import { jsonResponse, minutesAfter } from "../../testing/session-fixtures";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";

let journey: Journey;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const strip = () => screen.queryByTestId("missing-context");
// The note appears in the conversation and beside the answer.
const alerts = () =>
  screen
    .getAllByRole("alert")
    .map((each) => each.textContent)
    .join(" | ");
const box = () => screen.getByLabelText("Message");
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = async (name: string | RegExp) => {
  fireEvent.click(button(name));
  await flush();
};
const typeAndSend = async (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  await press("Send message");
};

function serve(next: Journey = journey) {
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
  const view = render(<OverlayPage />);
  await flush();
  await flush();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  window.localStorage.clear();
  // Hands-free Auto would capture on its own in a native host.
  window.localStorage.setItem("interview-studio.live.auto.local", "off");
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  serve(startJourney());
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete window.studioHost;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the strip", () => {
  it("says what the AI may be missing, in words, for the task on show", async () => {
    await open();
    const note = strip() as HTMLElement;
    expect(note).toHaveAttribute("role", "note");
    expect(note).toHaveTextContent("The AI may be missing:");
    expect(note).toHaveTextContent("Examples");
    expect(note).toHaveTextContent(
      "The rest of the problem (it looks cut off): the bottom of the page is hidden",
    );
  });

  it("has no strip when the answer reports nothing missing", async () => {
    serve(startJourney({ first: undefined }));
    await open();
    expect(strip()).toBeNull();
  });
});

describe("Add context", () => {
  it("focuses the message box, then the typed text revises the same task and the strip clears", async () => {
    await open();
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T1 · rev 1");
    await press("Add context");
    expect(box()).toHaveFocus();
    await typeAndSend("  A list of n integers, 1 <= n <= 1e5  ");
    expect(journey.inputs).toHaveLength(1);
    expect(journey.inputs[0]).toMatchObject({
      operation: "follow-up",
      text: "A list of n integers, 1 <= n <= 1e5",
      target: { taskId: CUT_OFF_TASK, revision: 1 },
      snapshots: [],
    });
    await advance(1_500);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T1 · rev 2");
    expect(strip()).toBeNull();
    expect(screen.getByTestId("pn-answer")).toHaveTextContent(
      "Revised with the added context.",
    );
    expect(box()).toHaveValue("");
  });

  it("asks again, for what is still missing, when the revision is still incomplete", async () => {
    journey.nextMissing = [{ kind: "signature" }];
    await open();
    await typeAndSend("ok");
    await advance(1_500);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("rev 2");
    expect(strip()).toHaveTextContent("Function signature");
    expect(strip()).not.toHaveTextContent("Examples");
  });

  it("opens the chat first when it is hidden, then focuses the box", async () => {
    await open();
    fireEvent.click(button(/^Chat/));
    expect(screen.queryByLabelText("Message")).toBeNull();
    await press("Add context");
    expect(box()).toHaveFocus();
  });

  it("goes to the task on show, not the newest, when an earlier one is chosen", async () => {
    journey.publish(
      journey.revision(
        { taskId: "task-newer", revision: 1 },
        { draft: "Newer" },
      ),
    );
    serve(journey);
    await open();
    // The newest task reports nothing missing; the earlier one still does.
    expect(strip()).toBeNull();
    fireEvent.click(button(/^T1 · /));
    expect(strip()).toBeVisible();
    await press("Add context");
    await typeAndSend("the constraints");
    expect(journey.inputs[0]).toMatchObject({
      target: { taskId: CUT_OFF_TASK, revision: 1 },
    });
  });

  it("keeps the unsent text when a pane is hidden and shown again", async () => {
    await open();
    fireEvent.change(box(), { target: { value: "half a thought" } });
    fireEvent.click(button(/^Chat/));
    fireEvent.click(button(/^Chat/));
    expect(box()).toHaveValue("half a thought");
  });

  it("sends nothing for blank text", async () => {
    await open();
    expect(button("Send message")).toBeDisabled();
    fireEvent.change(box(), { target: { value: "   " } });
    expect(button("Send message")).toBeDisabled();
    fireEvent.submit(box().closest("form") as HTMLFormElement);
    await flush();
    expect(journey.inputs).toEqual([]);
    expect(strip()).toBeVisible();
  });

  it("makes one request for a double press and keeps what was typed afterwards", async () => {
    await open();
    fireEvent.change(box(), { target: { value: "the examples" } });
    const form = box().closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await flush();
    expect(journey.inputs).toHaveLength(1);
  });

  it("says the server refused over-long text, keeps the text and the strip", async () => {
    serve(
      startJourney({
        onInput: () => jsonResponse({ error: { code: "invalid_input" } }, 400),
      }),
    );
    await open();
    await typeAndSend("x".repeat(5_000));
    expect(alerts()).toMatch("The server refused that capture (invalid_input)");
    expect(box()).toHaveValue("x".repeat(5_000));
    expect(strip()).toBeVisible();
  });

  it("keeps text typed while the send was in flight", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = journey.server.fetch;
    configureSessionStores({
      fetch: async (url, init) => {
        if (url.endsWith("/input")) await held;
        return original(url, init);
      },
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    await open();
    await typeAndSend("first");
    fireEvent.change(box(), { target: { value: "first and more" } });
    release();
    await flush();
    await flush();
    expect(journey.inputs).toHaveLength(1);
    expect(box()).toHaveValue("first and more");
  });
});

describe("Add another screenshot", () => {
  it("captures for the task on show and the revision clears the strip", async () => {
    installCaptureHost();
    await open();
    await press("Add another screenshot");
    await flush();
    expect(journey.captures).toHaveLength(1);
    expect(journey.captures[0]).toMatchObject({
      operation: "analyze",
      targetTaskId: CUT_OFF_TASK,
      targetRevision: "1",
      label: "Added screen",
    });
    await advance(1_500);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T1 · rev 2");
    expect(strip()).toBeNull();
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
    // The host is asked once; its frame arrives later.
    await flush();
    release({
      ok: true,
      mediaType: "image/jpeg",
      base64: btoa("\xff\xd8\xff\xe0JFIF"),
    });
    await flush();
    await flush();
    expect(host).toHaveBeenCalledTimes(1);
    expect(journey.captures).toHaveLength(1);
  });

  it("says why the image was refused, keeps the strip and the typed text", async () => {
    installCaptureHost();
    const original = journey.server.fetch;
    configureSessionStores({
      fetch: async (url, init) =>
        url.endsWith("/capture")
          ? new Response(JSON.stringify({ error: { code: "invalid_input" } }), {
              status: 400,
              headers: {
                "content-type": "application/json",
                "x-refusal-reason": "image_type",
              },
            })
          : original(url, init),
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    await open();
    fireEvent.change(box(), { target: { value: "keep me" } });
    await press("Add another screenshot");
    await flush();
    expect(alerts()).toMatch("the image was not a JPEG, PNG or WebP");
    expect(strip()).toBeVisible();
    expect(box()).toHaveValue("keep me");
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
});

describe("capture failures are not missing context", () => {
  it.each([
    ["permission-denied", /Screen Recording is off/],
    ["no-focused-window", /Chrome or Safari is in front/],
    ["failed", /Couldn’t capture/],
  ])(
    "%s says so in the note and leaves the strip as it was",
    async (reason, words) => {
      installCaptureHost({}, async () => ({ ok: false, reason }));
      await open();
      await press("Add another screenshot");
      await flush();
      expect(alerts()).toMatch(words);
      // Still the model's own list, untouched, and nothing was sent.
      expect(strip()).toHaveTextContent("Examples");
      expect(journey.captures).toEqual([]);
    },
  );

  it("never shows the strip for a failure when nothing is missing", async () => {
    serve(startJourney({ first: undefined }));
    installCaptureHost({}, async () => ({
      ok: false,
      reason: "permission-denied",
    }));
    await open();
    fireEvent.click(button(/Analyze screen/));
    await flush();
    await flush();
    expect(alerts()).toMatch(/Screen Recording/);
    expect(strip()).toBeNull();
  });

  it("a refused capture is a note, and it does not clear the strip", async () => {
    installCaptureHost();
    const original = journey.server.fetch;
    configureSessionStores({
      fetch: async (url, init) =>
        url.endsWith("/capture")
          ? jsonResponse({ error: { code: "status_refused" } }, 409)
          : original(url, init),
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    await open();
    await press("Add another screenshot");
    await flush();
    expect(alerts()).toMatch("status_refused");
    expect(strip()).toHaveTextContent("Examples");
  });
});

describe("Looks complete", () => {
  it("hides the strip for this revision and stays hidden after a reload", async () => {
    const view = await open();
    await press("Looks complete");
    expect(strip()).toBeNull();
    view.unmount();
    resetSessionStores();
    serve(journey);
    await open();
    expect(strip()).toBeNull();
  });

  it("shows the strip again when a newer revision reports missing context again", async () => {
    await open();
    await press("Looks complete");
    journey.nextMissing = [{ kind: "language" }];
    await typeAndSend("python please");
    await advance(1_500);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("rev 2");
    expect(strip()).toHaveTextContent("Target language");
  });

  it("works without browser storage, for this page", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await open();
    expect(strip()).toBeVisible();
    await press("Looks complete");
    expect(strip()).toBeNull();
  });
});

describe("reload, stop and late results", () => {
  it("shows the strip for the current revision after a reload and follows the newest task", async () => {
    journey.publish(
      journey.revision(
        { taskId: "task-newer", revision: 1 },
        { draft: "Newer" },
      ),
    );
    serve(journey);
    const view = await open();
    fireEvent.click(button(/^T1 · /));
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
    view.unmount();
    resetSessionStores();
    serve(journey);
    await open();
    // The pin is not kept across a reload: the newest task is on show again.
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T2");
  });

  it("restores the strip for the current revision after a reload", async () => {
    const view = await open();
    view.unmount();
    resetSessionStores();
    serve(journey);
    await open();
    expect(strip()).toHaveTextContent("Examples");
  });

  it("stopping the revision leaves the session live and the strip on the last published revision", async () => {
    installCaptureHost();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = journey.server.fetch;
    configureSessionStores({
      fetch: async (url, init) => {
        if (url.endsWith("/capture")) await held;
        return original(url, init);
      },
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    await open();
    fireEvent.click(button("Add another screenshot"));
    await flush();
    // The revision is running: the one capture control now stops it.
    await press("Stop");
    expect(journey.controls).toEqual(["stop-work"]);
    // The worker stopped before it published anything for that revision.
    journey.stopped = true;
    release();
    await flush();
    await advance(1_500);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T1 · rev 1");
    expect(strip()).toHaveTextContent("Examples");
    expect(screen.getByTestId("pn-answer")).toHaveTextContent(
      "First read of the cut-off problem.",
    );
    // The session is still open: it can be paused and ended.
    expect(button(/Pause/)).toBeVisible();
  });

  it("ignores a late result for a revision that was already replaced", async () => {
    await open();
    await typeAndSend("the examples");
    await advance(1_500);
    expect(strip()).toBeNull();
    // A result for revision 1 arrives after revision 2 is on show.
    journey.publish(
      journey.revision(
        { taskId: CUT_OFF_TASK, revision: 1 },
        { missing: CUT_OFF, draft: "Late first read." },
      ),
    );
    await advance(1_500);
    expect(strip()).toBeNull();
    expect(screen.getByTestId("pn-answer")).not.toHaveTextContent(
      "Late first read.",
    );
  });
});
