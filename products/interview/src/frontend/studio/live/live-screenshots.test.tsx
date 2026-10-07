// The Screenshots icon and area on both real surfaces (the native answer pane
// and the web task panel), through the real page, hands-free controller, store
// and routes' wire shapes (a fake server: no model). The parts themselves are
// covered in shared/screenshots-area.test.tsx; these show them wired: the icon
// in the task line (the card is closed until the icon opens it, in every
// mode), the strip from the read route, the Manual tray staging on the device,
// and Apply as ONE request that revises the SAME task.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "./focus-presentation";
import { LiveSessionView } from "./live-view";
import { HandsFreeProvider } from "./overlay/hands-free-context";
import { OverlayPage } from "./overlay/overlay-page";
import { resetCommandClaims } from "./overlay/panels/commands";
import { configureSessionStores, resetSessionStores } from "./session-registry";
import {
  CUT_OFF_TASK,
  installCaptureHost,
  type Journey,
  startJourney,
} from "./testing/missing-context-kit";
import { jsonResponse, minutesAfter } from "./testing/session-fixtures";

const studio = {} as never;
let journey: Journey;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const click = async (element: HTMLElement) => {
  fireEvent.click(element);
  await flush();
};
// The Screenshots icon in the task line: the card is closed until it opens it.
const toggle = () => screen.getByTestId("screenshots-toggle");
const openCard = async () => {
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
  await click(toggle());
  expect(toggle()).toHaveAttribute("aria-expanded", "true");
};

const SHOT = {
  ordinal: 1,
  sourceId: "screen",
  eventId: "evt-1",
  sequence: 1,
  capturedAt: "2026-10-05T10:00:00.000Z",
  artifactId: "art-1",
  ocrEngine: "vision",
  display: { name: "Studio Display", index: 2, count: 3 },
  revisions: [1],
};

function serve(next: Journey) {
  journey = next;
  journey.server.on(`GET /:id/tasks/${CUT_OFF_TASK}/screenshots`, () =>
    jsonResponse({ taskId: CUT_OFF_TASK, screenshots: [SHOT] }),
  );
  configureSessionStores({
    fetch: journey.server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
}

const SURFACES = [
  {
    name: "native answer pane",
    line: () => screen.getByTestId("pn-task-line"),
    open: async () => {
      window.history.replaceState(
        {},
        "",
        "/t/local/p/interview/live/overlay?panel=single&host=native",
      );
      render(<OverlayPage />);
    },
  },
  {
    name: "web task panel",
    line: () => screen.getByTestId("task-panel"),
    open: async () => {
      render(
        <HandsFreeProvider>
          <LiveSessionView rest={[]} studio={studio} />
        </HandsFreeProvider>,
      );
    },
  },
] as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  // Manual capture (Auto would capture on its own in a native host).
  window.localStorage.setItem("interview-studio.live.auto.local", "off");
  let n = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:staged-${(n += 1)}`),
      revokeObjectURL: vi.fn(),
    }),
  );
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  serve(startJourney({ first: undefined }));
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  delete window.studioHost;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(SURFACES)("$name", (surface) => {
  const open = async () => {
    installCaptureHost();
    await surface.open();
    await flush();
    await flush();
  };

  it("has the Screenshots icon in the task line, counting the task's screenshots, and the card closed until opened", async () => {
    await open();
    const icon = within(surface.line()).getByRole("button", {
      name: "Screenshots (1)",
    });
    expect(icon).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("screenshots-area")).toBeNull();
    // The icon opens it (in Manual too), and closes it again.
    await click(icon);
    expect(icon).toHaveAttribute("aria-expanded", "true");
    const area = screen.getByTestId("screenshots-area");
    expect(area).toHaveAttribute("data-mode", "manual");
    const strip = within(area).getByTestId("screenshot-strip");
    expect(strip).toHaveTextContent("S1");
    expect(strip).toHaveTextContent("Display 2 of 3");
    expect(strip).toHaveTextContent("rev 1");
    await click(icon);
    expect(screen.queryByTestId("screenshots-area")).toBeNull();
  });

  it("opens a stored image in the viewer from the existing screenshot route only", async () => {
    await open();
    await openCard();
    await click(screen.getByRole("button", { name: "Open S1" }));
    const dialog = screen.getByRole("dialog", { name: "Screenshot S1" });
    expect(within(dialog).getByAltText("Screenshot S1")).toHaveAttribute(
      "src",
      expect.stringMatching(/\/sessions\/[^/]+\/screenshots\/art-1$/),
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stages on the device and Apply makes ONE request: a new revision of the SAME task", async () => {
    await open();
    await openCard();
    await click(screen.getByTestId("add-screenshot"));
    expect(journey.captures).toHaveLength(0);
    expect(screen.getByTestId("staged-1")).toHaveTextContent("Not sent yet");
    expect(
      screen.getByRole("button", { name: "Screenshots (2)" }),
    ).toBeVisible();
    await click(screen.getByTestId("apply-screenshots"));
    expect(journey.captures).toHaveLength(1);
    expect(journey.captures[0]).toMatchObject({
      targetTaskId: CUT_OFF_TASK,
      targetRevision: "1",
    });
    await advance(1_500);
    expect(surface.line()).toHaveTextContent("T1 · rev 2");
    expect(screen.queryByTestId("staged-1")).toBeNull();
  });

  // A new problem is no longer chosen in the tray: the native pane captures one
  // (Capture new problem); staged screenshots always add to the task on show.
  it("forces a plain regenerate with nothing staged: one new revision, no image", async () => {
    await open();
    await openCard();
    let regenerated: unknown;
    journey.server.on("POST /:id/input", ({ body }) => {
      regenerated = body;
      journey.publish(journey.revision({ taskId: CUT_OFF_TASK, revision: 2 }));
      return jsonResponse({ input: { requestId: "r", sequence: 20 } }, 202);
    });
    await click(screen.getByTestId("apply-screenshots"));
    await advance(1_500);
    expect(journey.captures).toHaveLength(0);
    expect(regenerated).toMatchObject({
      operation: "regenerate",
      target: { taskId: CUT_OFF_TASK, revision: 1 },
    });
    expect(surface.line()).toHaveTextContent("rev 2");
  });
});

describe("native 'To apply' dock", () => {
  const open = async () => {
    installCaptureHost();
    SURFACES[0].open();
    await flush();
    await flush();
  };
  // The Answer panel's own dock: the chat panel's composer lives in a dock slot too.
  const dock = () =>
    document
      .querySelector('[data-testid="pn-analysis"]')
      ?.querySelector('[data-slot="panel-dock"]') as HTMLElement | null;

  it("is inside the Answer panel and present only while a screenshot is staged", async () => {
    await open();
    expect(dock()).toBeNull();
    await openCard();
    expect(dock()).toBeNull();
    await click(screen.getByTestId("add-screenshot"));
    const found = dock();
    expect(found).not.toBeNull();
    expect(screen.getByRole("region", { name: "Answer" }).contains(found)).toBe(
      true,
    );
    expect(found).toHaveTextContent("To apply · 1");
    expect(within(found as HTMLElement).getByTestId("staged-1")).toBeVisible();
    for (const control of [
      "add-screenshot",
      "discard-screenshots",
      "apply-screenshots",
    ])
      expect(within(found as HTMLElement).getByTestId(control)).toBeVisible();
    expect(
      within(found as HTMLElement).getByTestId("discard-screenshots"),
    ).toHaveTextContent("Clear");
  });

  it("Clear removes the staged screenshot and the dock with it, sending nothing", async () => {
    await open();
    await openCard();
    await click(screen.getByTestId("add-screenshot"));
    await click(screen.getByTestId("discard-screenshots"));
    expect(dock()).toBeNull();
    expect(journey.captures).toHaveLength(0);
  });

  it("removes one staged screenshot from its thumbnail", async () => {
    await open();
    await openCard();
    await click(screen.getByTestId("add-screenshot"));
    await click(screen.getByRole("button", { name: "Remove New 1" }));
    expect(dock()).toBeNull();
  });
});

describe("device-only", () => {
  it.each(SURFACES)(
    "$name disables Add with the reason before anything is added",
    async (surface) => {
      serve(
        startJourney({
          first: undefined,
          session: { processingPolicy: "device-only" },
        }),
      );
      installCaptureHost();
      await surface.open();
      await flush();
      await flush();
      await openCard();
      expect(screen.getByTestId("add-screenshot")).toBeDisabled();
      expect(screen.getByTestId("add-reason")).toHaveTextContent(
        "Device-only mode never sends a screenshot",
      );
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "no screenshot leaves this device",
      );
    },
  );
});
