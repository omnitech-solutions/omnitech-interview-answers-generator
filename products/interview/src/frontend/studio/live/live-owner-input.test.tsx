// Analyze latest capture and typed follow-ups end to end through the real
// store, the real session client and the real Focus view, against a scripted
// server: the request names the newest snapshot by its observation ids (and a
// follow-up the task revision last answered), carries no bytes or identity,
// and the answer the server then publishes shows up in the Focus view.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCardHost } from "./card-host";
import { LiveFloatHost } from "./float-host";
import { presentation } from "./focus-presentation";
import { LiveSessionView } from "./live-view";
import { HandsFreeProvider } from "./overlay/hands-free-context";
import { configureSessionStores, resetSessionStores } from "./session-registry";
import { answerAction } from "./testing/live-view-kit";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "./testing/session-fixtures";
import { answerResult } from "./testing/session-result-fixtures";
import {
  createTestServer,
  type TestServer,
} from "./testing/session-test-server";

const studio = {} as never;
let server: TestServer;
let page: ReturnType<typeof streamPage>;
let bodies: unknown[] = [];

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
// The card opens over the page; the header's one control is Pop out.
const openCard = async () => {
  act(() => presentation.setMode("card"));
  await flush();
};
const click = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
};

// Capture & analyze with nothing shared opens the source menu; the companion's
// latest capture starts a new task from its newest frame.
async function analyzeNew() {
  await click(/Capture & analyze/);
  fireEvent.click(
    screen.getByRole("menuitem", { name: /Analyze stored capture/ }),
  );
  await flush();
}

async function openFocus() {
  render(
    <HandsFreeProvider>
      <LiveSessionView rest={[]} studio={studio} />
      <LiveCardHost />
      <LiveFloatHost />
    </HandsFreeProvider>,
  );
  await flush();
  await flush();
  await openCard();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/");
  resetSessionStores();
  presentation.reset();
  bodies = [];
  page = streamPage({
    session: sessionView({
      processingPolicy: "permitted-remote",
      captureSources: ["microphone", "screen"],
    }),
    // Two captures: the request must name the newest.
    observations: [snapshot(1), snapshot(2, "Problem statement")],
    nextAfterSequence: 2,
    actions: [
      answerAction(answerResult(), { taskId: "task-spoken", taskRevision: 2 }),
    ],
  });
  server = createTestServer(() => page);
  server.on("GET /current", () =>
    jsonResponse({
      session: sessionView({
        processingPolicy: "permitted-remote",
        captureSources: ["microphone", "screen"],
      }),
    }),
  );
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
});
afterEach(() => {
  presentation.reset();
  resetSessionStores();
  vi.useRealTimers();
});

describe("Analyze latest capture and follow-ups", () => {
  it("sends the newest snapshot's observation ids and shows the answer that follows", async () => {
    server.on("POST /:id/input", ({ body }) => {
      bodies.push(body);
      // The worker answers the screenshot as a new task; the stream carries it.
      page = {
        ...page,
        actions: [
          ...page.actions,
          answerAction(
            answerResult({ draft: "Read the screenshot: a sliding window." }),
            {
              taskId: "task-i.r-1",
              taskRevision: 1,
              createdAt: minutesAfter(2),
            },
          ),
        ],
      };
      return jsonResponse(
        {
          input: {
            requestId: (body as { requestId: string }).requestId,
            sequence: 9,
          },
        },
        202,
      );
    });
    await openFocus();
    await analyzeNew();
    expect(bodies).toHaveLength(1);
    const sent = bodies[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      operation: "analyze",
      snapshots: [{ sourceId: "screen", eventId: "evt-2" }],
    });
    expect(sent["requestId"]).toEqual(expect.stringMatching(/^r-/));
    // No bytes, paths, text or identity travel with it.
    expect(Object.keys(sent).sort()).toEqual(
      ["language", "operation", "requestId", "skill", "snapshots"].sort(),
    );
    await advance(1_500);
    expect(
      within(screen.getByTestId("overlay-card")).getByText(
        "Read the screenshot: a sliding window.",
      ),
    ).toBeVisible();
  });

  it("sends a typed follow-up aimed at the task revision last answered", async () => {
    server.on("POST /:id/input", ({ body }) => {
      bodies.push(body);
      return jsonResponse({ input: { requestId: "r", sequence: 3 } }, 202);
    });
    await openFocus();
    fireEvent.change(screen.getByLabelText("Follow-up"), {
      target: { value: "  and the cost?  " },
    });
    await click("Send follow-up");
    expect(bodies[0]).toMatchObject({
      operation: "follow-up",
      text: "and the cost?",
      target: { taskId: "task-spoken", revision: 2 },
      snapshots: [],
    });
  });

  it("sends a follow-up to the pinned earlier task at its own revision, not the newest", async () => {
    page = {
      ...page,
      actions: [
        answerAction(answerResult(), {
          taskId: "task-first",
          taskRevision: 3,
          createdAt: minutesAfter(0, 10),
        }),
        answerAction(answerResult(), {
          taskId: "task-second",
          taskRevision: 1,
          createdAt: minutesAfter(0, 40),
        }),
      ],
    };
    server.on("POST /:id/input", ({ body }) => {
      bodies.push(body);
      return jsonResponse({ input: { requestId: "r", sequence: 3 } }, 202);
    });
    await openFocus();
    act(() => presentation.pin("task-first"));
    await flush();
    const input = screen.getByLabelText("Follow-up");
    expect(input).toHaveAttribute(
      "placeholder",
      "Add context to T1, or ask a follow-up",
    );
    fireEvent.change(input, { target: { value: "why?" } });
    await click("Send follow-up");
    expect(bodies[0]).toMatchObject({
      operation: "follow-up",
      target: { taskId: "task-first", revision: 3 },
    });
  });

  it("sends a second, different follow-up while the first is still pending, as its own request", async () => {
    const releases: (() => void)[] = [];
    server.on(
      "POST /:id/input",
      ({ body }) =>
        new Promise<Response>((resolve) => {
          bodies.push(body);
          releases.push(() =>
            resolve(
              jsonResponse({ input: { requestId: "r", sequence: 3 } }, 202),
            ),
          );
        }),
    );
    await openFocus();
    const input = screen.getByLabelText("Follow-up");
    fireEvent.change(input, { target: { value: "first question" } });
    await click("Send follow-up");
    // The box stays usable while the first is on its way.
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "second question" } });
    await click("Send follow-up");
    expect(bodies.map((body) => (body as { text: string }).text)).toEqual([
      "first question",
      "second question",
    ]);
    const ids = bodies.map((body) => (body as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(2);
    // The first finishing does not clear what was typed for the second.
    fireEvent.change(input, { target: { value: "third, still typing" } });
    for (const release of releases) release();
    await flush();
    await flush();
    expect(input).toHaveValue("third, still typing");
  });

  it("explains a refusal from the server in the Focus view", async () => {
    server.on("POST /:id/input", () =>
      jsonResponse({ error: { code: "status_refused" } }, 409),
    );
    await openFocus();
    await analyzeNew();
    expect(
      within(screen.getByTestId("overlay-card")).getByRole("alert"),
    ).toBeVisible();
    expect(server.count("POST /:id/input")).toBe(1);
  });

  it("with no capture yet, asks for nothing and sends nothing", async () => {
    page = { ...page, observations: [], nextAfterSequence: 0 };
    server.on("POST /:id/input", ({ body }) => {
      bodies.push(body);
      return jsonResponse({ input: { requestId: "r", sequence: 1 } }, 202);
    });
    await openFocus();
    // Nothing from the companion to use: that choice is disabled.
    await click(/Capture & analyze/);
    expect(
      screen.getByRole("menuitem", { name: /Analyze stored capture/ }),
    ).toBeDisabled();
    expect(bodies).toEqual([]);
  });
});
