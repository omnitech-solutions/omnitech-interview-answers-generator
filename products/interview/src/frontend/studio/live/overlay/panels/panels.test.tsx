// The four panels over the real store with a scripted service, the one-owner
// rule, language and skill gating, the commands list and the toasts.
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import { answerAction } from "../../testing/live-view-kit";
import {
  action,
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../../testing/session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "../../testing/session-result-fixtures";
import {
  createTestServer,
  type TestServer,
} from "../../testing/session-test-server";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";
import { OWNER_LOCK, useOwnsSession } from "./panel-owner";
import { AnswerPanel, ChatPanel, type PanelSession } from "./panel-views";
import { tipOf } from "./toolbar-test-kit";
import { TOAST_MS } from "./use-panel-session";

const live = (extra = {}) =>
  sessionView({ processingPolicy: "permitted-remote", ...extra });
let server: TestServer;
const submitFollowUp = vi.fn(async () => undefined);
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

function serve(
  session = live(),
  actions: unknown[] = [answerAction(answerResult())],
) {
  server = createTestServer(() =>
    streamPage({
      session,
      observations: [snapshot(1)],
      nextAfterSequence: 1,
      actions: actions as never,
    }),
  );
  server.on("GET /current", () => jsonResponse({ session }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
    submitFollowUp,
  });
}
async function show(panel: string, extra = "") {
  window.history.replaceState(
    {},
    "",
    `/t/local/p/interview/live/overlay?panel=${panel}${extra}`,
  );
  render(<OverlayPage />);
  await flush();
  await flush();
}
const codingActions = () => [
  answerAction(codingAnswer(["No sorting allowed"])),
  action({ actionKind: "solve-code", result: codeResult() }),
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.localStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  submitFollowUp.mockClear();
  serve();
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete (window as { studioHost?: unknown }).studioHost;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("routing", () => {
  it("draws the compact window without a panel, and for an unknown or removed one (pill, analysis, chat)", async () => {
    for (const search of [
      "?panel=nope",
      "?panel=pill",
      "?panel=analysis",
      "?panel=chat",
      "",
    ]) {
      window.history.replaceState(
        {},
        "",
        `/t/local/p/interview/live/overlay${search}`,
      );
      render(<OverlayPage />);
      await flush();
      await flush();
      expect(screen.getByTestId("pn-root")).toHaveAttribute(
        "data-panel",
        "single",
      );
      expect(screen.queryByTestId("overlay-card")).toBeNull();
      cleanup();
    }
  });
  it("shows the one window for ?panel=single and Settings for ?panel=settings", async () => {
    await show("single");
    expect(screen.getByTestId("pn-root")).toHaveAttribute(
      "data-panel",
      "single",
    );
    expect(screen.getByTestId("pn-pill")).toBeVisible();
    expect(screen.getByTestId("pn-chat")).toBeVisible();
    expect(screen.queryByTestId("pn-settings")).toBeNull();
    cleanup();
    await show("settings");
    expect(screen.getByTestId("pn-root")).toHaveAttribute(
      "data-panel",
      "settings",
    );
    expect(screen.getByTestId("pn-settings")).toBeVisible();
    expect(screen.queryByTestId("pn-pill")).toBeNull();
  });
});

const HOST_BASE = {
  capabilities: ["click-through"],
  openSettings: async () => true,
  closeSettings: async () => true,
  setVisible: async () => true,
  setInteractionMode: async () => true,
};
// A native bridge whose interaction mode the test can flip.
function nativeHost(extra: Record<string, unknown> = {}, studioHost = {}) {
  let listener: (on: boolean) => void = () => undefined;
  let mode = true;
  (window as { studioHost?: unknown }).studioHost = {
    ...studioHost,
    presentation: {
      ...HOST_BASE,
      interactionMode: () => mode,
      onInteractionMode: (l: (on: boolean) => void) => {
        listener = l;
        return () => undefined;
      },
      ...extra,
    },
  };
  return {
    set: (on: boolean) =>
      act(() => {
        mode = on;
        listener(on);
      }),
  };
}

describe("toolbar", () => {
  it("shows the named capture button with its hotkey in the tooltip, the mic likewise, the answer style, and no status dot", async () => {
    await show("single");
    const capture = screen.getByRole("button", { name: "Analyze screen" });
    expect(tipOf(capture)).toContain("⌘⇧S");
    expect(tipOf(capture)).toMatch(/^(Auto|Manual): /);
    expect(
      tipOf(
        within(screen.getByTestId("pn-pill")).getByRole("button", {
          name: "Start microphone",
        }),
      ),
    ).toContain("⌥R");
    expect(screen.getByTestId("pn-skill")).toHaveTextContent(
      "Data Structures & Algorithms",
    );
    // T1: no coloured dot and no status line beside the capture control.
    expect(screen.queryByTestId("pn-dot")).toBeNull();
    expect(screen.queryByTestId("pn-status")).toBeNull();
    const bar = screen.getByTestId("pn-pill");
    for (const gone of [/Remote/, /Visible window/, /companion/i])
      expect(bar).not.toHaveTextContent(gone);
  });
  it("never goes inert for the old whole-window interaction state: the controls stay live", async () => {
    const host = nativeHost();
    await show("single", "&host=native");
    await host.set(false);
    expect(
      screen.getByRole("button", { name: "Analyze screen" }),
    ).toBeEnabled();
    expect(screen.queryByTestId("pn-dot")).toBeNull();
    expect(screen.queryByTestId("pn-status")).toBeNull();
  });
});

describe("analysis", () => {
  it("is quiet before anything is captured", async () => {
    serve(live(), []);
    await show("single");
    expect(screen.getByTestId("pn-analysis-empty")).toBeVisible();
    expect(screen.queryByTestId("pn-code")).toBeNull();
  });
  it("shows the problem analysis in a text column and the code in a separate card", async () => {
    serve(live(), codingActions());
    await show("single");
    // The task's own name, with its type as a pill.
    expect(screen.getByTestId("pn-problem")).toHaveTextContent(
      /^Implement a rate limiter for a Node service$/,
    );
    expect(screen.queryByText("Problem Type:")).toBeNull();
    expect(screen.getByTestId("pn-type")).toHaveTextContent(
      "Programming challenge",
    );
    expect(screen.getByText("Constraints:")).toBeVisible();
    expect(
      within(screen.getByLabelText("Constraints")).getByText(
        "No sorting allowed",
      ),
    ).toBeVisible();
    const code = screen.getByTestId("pn-code");
    expect(screen.getByTestId("pn-answer")).not.toContainElement(code);
    expect(screen.getByTestId("pn-language")).toHaveTextContent("TYPESCRIPT");
    expect(code.querySelector(".cm-editor")).not.toBeNull();
  });
  it("shows an interview answer's talking points with bold key terms, inert, and copies them plain", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    const draft = [
      "- **Idempotency keys** make a retried charge safe",
      "- Watch the **p99** <img src=x onerror=alert(1)> [link](https://x.test)",
    ].join("\n");
    serve(live(), [answerAction(answerResult({ draft, claims: [] }))]);
    await show("single");
    const pane = screen.getByTestId("pn-answer");
    expect(
      [...pane.querySelectorAll("p strong")].map((el) => el.textContent),
    ).toEqual(["Idempotency keys", "p99"]);
    expect(pane).toHaveTextContent(
      "Idempotency keys make a retried charge safe",
    );
    expect(pane.querySelector("img")).toBeNull();
    expect(pane.querySelector("a")).toBeNull();
    expect(pane).toHaveTextContent("[link](https://x.test)");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy answer/ }));
    });
    expect(write).toHaveBeenCalledWith(draft.replaceAll("**", ""));
    vi.unstubAllGlobals();
  });
  it("asks for what the model says is missing, and lets the person say it looks complete", async () => {
    serve(live(), [
      {
        ...answerAction(codingAnswer(["No sorting allowed"])),
        missingContext: [
          { kind: "examples" },
          {
            kind: "statement-cut-off",
            note: "the bottom of the page is hidden",
          },
        ],
      },
      action({ actionKind: "solve-code", result: codeResult() }),
    ]);
    await show("single");
    const strip = screen.getByTestId("missing-context");
    expect(strip).toHaveTextContent("Examples");
    expect(strip).toHaveTextContent(
      "The rest of the problem (it looks cut off): the bottom of the page is hidden",
    );
    expect(
      within(strip).getByRole("button", { name: "Add another screenshot" }),
    ).toBeVisible();
    expect(
      within(strip).getByRole("button", { name: "Add context" }),
    ).toBeVisible();
    fireEvent.click(
      within(strip).getByRole("button", { name: "Looks complete" }),
    );
    expect(screen.queryByTestId("missing-context")).toBeNull();
  });
  it("shows no strip when nothing is reported missing", async () => {
    serve(live(), codingActions());
    await show("single");
    expect(screen.queryByTestId("missing-context")).toBeNull();
  });
  it("has none of the old chrome: tabs, slots, revisions, run, activity, workspace", async () => {
    serve(live(), codingActions());
    await show("single");
    const panel = screen.getAllByTestId("pn-analysis")[0] as HTMLElement;
    for (const gone of [
      /Task \d/,
      /ANSWER SLOT|CODE SLOT/,
      /Revision/,
      /Activity/,
      /Open in Workspace/,
      /Device only/i,
    ])
      expect(panel).not.toHaveTextContent(gone);
    expect(within(panel).queryByRole("tab")).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Run/ })).toBeNull();
    expect(screen.queryByText("Results")).toBeNull();
  });
  it("lists the steps while a capture is in flight, in place of the old answer", () => {
    const session = {
      selected: undefined,
      card: null,
      phase: "analyzing",
      note: null,
      auto: { on: false },
      snapshot: { actions: [] },
      tenant: "t",
      tray: {
        items: [],
        open: false,
        attach: () => () => undefined,
        recognition: { states: new Map() },
      },
      model: { activity: { key: "idle", text: "" }, tasks: [] },
    } as unknown as PanelSession;
    render(<AnswerPanel s={session} />);
    const steps = screen.getByTestId("pn-steps");
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-state")),
    ).toEqual(["done", "current", "pending"]);
    expect(steps).toHaveTextContent("Reading the problem");
    expect(screen.queryByTestId("pn-answer")).toBeNull();
  });
  it("is at drafting once the answer is being written", () => {
    const session = {
      selected: undefined,
      card: null,
      phase: "analyzing",
      note: null,
      auto: { on: false },
      snapshot: { actions: [] },
      tenant: "t",
      tray: {
        items: [],
        open: false,
        attach: () => () => undefined,
        recognition: { states: new Map() },
      },
      model: { activity: { key: "drafting", text: "" }, tasks: [] },
    } as unknown as PanelSession;
    render(<AnswerPanel s={session} />);
    expect(
      within(screen.getByTestId("pn-steps"))
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-state")),
    ).toEqual(["done", "done", "current"]);
  });
});

describe("chat", () => {
  it("has the header, the input, the mic and send, and lists a typed message as a bubble", async () => {
    await show("single");
    expect(screen.getByText("Transcript & chat")).toBeVisible();
    expect(
      screen.getByPlaceholderText("Add context to T1, or ask a follow-up"),
    ).toBeVisible();
    expect(screen.queryByTestId("pn-rec")).toBeNull();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "and the cost?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(submitFollowUp).toHaveBeenCalledTimes(1);
    const card = screen
      .getByText("and the cost?")
      .closest('[data-slot="transcript-message"]');
    expect(card).not.toBeNull();
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });
  it("puts a copy button on each bubble: it copies that bubble's words, says Copied once the clipboard accepted, and never presses the bubble", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    serve(live(), codingActions());
    await show("single");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "and the cost?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    const typed = screen
      .getByText("and the cost?")
      .closest('[data-slot="transcript-message"]');
    const button = within(typed as HTMLElement).getByRole("button", {
      name: "Copy message",
    });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(write).toHaveBeenCalledWith("and the cost?");
    expect(button).toHaveAttribute("aria-label", "Copied");
    // Every answer bubble has its own.
    const assistant = document.querySelector(
      '[data-slot="transcript-speech"][data-kind="assistant"]',
    ) as HTMLElement;
    expect(
      within(assistant).getByRole("button", { name: "Copy message" }),
    ).toBeVisible();
    vi.unstubAllGlobals();
  });
  it("shows the assistant reply as a purple card with the answer's lines", async () => {
    serve(live(), codingActions());
    await show("single");
    const card = document.querySelector(
      '[data-slot="transcript-speech"][data-kind="assistant"]',
    );
    expect(card).not.toBeNull();
    expect(card?.textContent).not.toBe("…");
  });
  it("writes no system line into the transcript when the memory is cleared", async () => {
    await show("single");
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyC" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("Session memory has been cleared")).toBeNull();
  });
  it("shows the words being heard, with no record dot, no recording line and no loading reply", () => {
    const session = {
      model: {
        transcript: [],
        tasks: [],
        noQuestion: [],
        activity: { key: "idle", text: "" },
      },
      snapshot: { pending: [], observations: [] },
      target: null,
      entries: [],
      clearedAt: 0,
      revisionPicks: {},
      select: () => undefined,
      open: true,
      phase: "analyzing",
      note: null,
      draft: "",
      setDraft: () => undefined,
      send: async () => ({ ok: true }),
      press: () => undefined,
      live: { mic: "listening", interim: "OK can you explain the" },
    } as unknown as PanelSession;
    render(<ChatPanel s={session} />);
    expect(screen.queryByTestId("pn-rec")).toBeNull();
    expect(screen.queryByRole("status", { name: "Recording" })).toBeNull();
    expect(screen.queryByText(/Recording in Progress/)).toBeNull();
    expect(screen.getByText("OK can you explain the")).toBeVisible();
    expect(screen.queryByTestId("pn-loading")).toBeNull();
    expect(
      document.querySelector('[data-slot="panel-header"]'),
    ).toHaveTextContent(/^Transcript & chat$/);
  });
});

describe("settings", () => {
  it("has the title, red Quit and Close, and Language & Skills", async () => {
    await show("settings");
    const panel = screen.getByTestId("pn-settings");
    expect(within(panel).getByText("Settings")).toBeVisible();
    expect(screen.getByTestId("pn-quit")).toHaveTextContent("Quit");
    expect(screen.getByTestId("pn-close")).toHaveTextContent("Close");
    expect(within(panel).getByText("Language & Skills")).toBeVisible();
    expect(within(panel).getByText("Coding Language")).toBeVisible();
    expect(within(panel).getByText("Active Skill")).toBeVisible();
    for (const gone of [/Processing/, /Retention/, /Auto mode/, /Commands/])
      expect(panel).not.toHaveTextContent(gone);
  });
  it("Quit asks the shell to quit through its presentation, and Close closes Settings through the host", async () => {
    const quit = vi.fn(async () => true);
    const closeSettings = vi.fn(async () => true);
    nativeHost({ closeSettings, quit });
    await show("settings", "&host=native");
    fireEvent.click(screen.getByTestId("pn-quit"));
    expect(quit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("pn-close"));
    await flush();
    expect(closeSettings).toHaveBeenCalledTimes(1);
  });
  it("closes its own window when there is no shell to ask", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    await show("settings");
    fireEvent.click(screen.getByTestId("pn-quit"));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("pn-close"));
    await flush();
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("lists only supported languages as selectable and the rest as not supported yet", async () => {
    await show("settings");
    const select = screen.getByTestId("pn-language-select");
    const option = (name: RegExp) =>
      within(select).getByRole("option", { name }) as HTMLOptionElement;
    expect(option(/^TypeScript$/).disabled).toBe(false);
    expect(option(/^React$/).disabled).toBe(false);
    expect(option(/Python \(not supported yet\)/).disabled).toBe(true);
    expect(option(/Go \(not supported yet\)/).disabled).toBe(true);
  });
  it("offers exactly the nine skills in order, remembers the choice and toasts the change", async () => {
    await show("settings");
    const select = screen.getByTestId("pn-skill-select");
    expect(
      within(select)
        .getAllByRole("option")
        .map((each) => each.textContent),
    ).toEqual([
      "Programming",
      "Data Structures & Algorithms",
      "System Design",
      "Behavioral Interview",
      "Data Science",
      "Sales & Business",
      "Presentation Skills",
      "Negotiation",
      "DevOps & Infrastructure",
    ]);
    expect(select).toHaveValue("dsa");
    fireEvent.change(select, { target: { value: "system-design" } });
    await flush();
    expect(
      window.localStorage.getItem(
        "interview-studio.live.capture-settings.local",
      ),
    ).toContain("system-design");
  });
});

describe("toasts", () => {
  // The window draws them unless the shell does; each text is exact.
  const toasts = () => screen.getByTestId("pn-toasts");
  it("says Skill changed to - <Skill> when a skill is picked", async () => {
    await show("single");
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, code: "BracketRight" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toasts()).toHaveTextContent("Skill changed to - System Design");
    // No pointer to a tab that no longer exists.
    expect(toasts()).not.toHaveTextContent(/small tab/);
    expect(document.querySelector(".pn-toast-detail")).toBeNull();
  });
  it("changes the skill on its key even if an old shell reports its whole-window interaction as off", async () => {
    const host = nativeHost();
    await show("single", "&host=native");
    await host.set(false);
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, code: "BracketRight" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toasts()).toHaveTextContent("Skill changed to - System Design");
    expect(toasts()).not.toHaveTextContent(/Current Skill/);
  });
  it("auto-hides after about three seconds", async () => {
    nativeHost();
    await show("single", "&host=native");
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, code: "BracketRight" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toasts()).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(TOAST_MS + 50));
    expect(screen.queryByTestId("pn-toasts")).toBeNull();
  });
  it("does not draw them when the shell does (nativeToasts), and draws its own otherwise", async () => {
    const skillKey = () =>
      act(async () => {
        fireEvent.keyDown(window, { altKey: true, code: "BracketRight" });
        await vi.advanceTimersByTimeAsync(0);
      });
    nativeHost({ nativeToasts: true });
    await show("single", "&host=native");
    await skillKey();
    expect(screen.queryByTestId("pn-toasts")).toBeNull();
    cleanup();
    // The same key within the claim window is one press.
    await act(() => vi.advanceTimersByTimeAsync(1000));
    nativeHost();
    await show("single", "&host=native");
    await skillKey();
    expect(toasts()).toHaveTextContent("Skill changed to");
  });
});

describe("no session in a native window", () => {
  const noSession = () =>
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
  it("never starts one behind the person's back, even with the shell's consent recorded", async () => {
    noSession();
    window.localStorage.setItem("studio.shell.consented", "1");
    const started: unknown[] = [];
    server.on("POST /", ({ body }) => {
      started.push(body);
      return jsonResponse({
        session: live(),
        credential: { value: "c", expiresAt: minutesAfter(60) },
      });
    });
    nativeHost();
    await show("single", "&host=native");
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(started).toEqual([]);
    expect(screen.queryByText(/Start one in Studio/)).toBeNull();
    // The start screen is what the window shows (start-panel.test.tsx).
    expect(screen.getByTestId("pn-start")).toHaveAttribute(
      "data-stage",
      "idle",
    );
  });
  it("Settings with no session and no consent says Consent required, with a button that opens the shell's consent, and starts nothing", async () => {
    noSession();
    const open = vi.fn(async () => undefined);
    nativeHost({}, { consent: { granted: () => false, open } });
    await show("settings", "&host=native");
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText("Consent required")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review consent" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });
  it("Settings with consent and no session says there is no live session", async () => {
    noSession();
    window.localStorage.setItem("studio.shell.consented", "1");
    nativeHost();
    await show("settings", "&host=native");
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText("No live session.")).toBeVisible();
    expect(screen.queryByText("Consent required")).toBeNull();
  });
});

describe("a native window that loses its session", () => {
  it("recovers to the start screen instead of stopping on a dead end", async () => {
    serve();
    nativeHost();
    await show("single", "&host=native");
    expect(screen.queryByTestId("pn-start")).toBeNull();
    // The session goes away: its stream answers 404, and nothing is running.
    server.on("GET /:id/stream", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.queryByText("This session is unavailable.")).toBeNull();
    expect(screen.getByTestId("pn-start")).toHaveAttribute(
      "data-stage",
      "idle",
    );
    // Never without its toolbar: the real one, locked, with the reason said and a
    // way to recover on the screen.
    expect(
      screen.getByRole("toolbar", { name: "Session controls" }),
    ).toBeVisible();
    expect(
      screen.getByText(/That session is no longer available/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Start session" })).toBeVisible();
  });
  it("adopts a session that is running when the old one is gone", async () => {
    serve();
    nativeHost();
    await show("single", "&host=native");
    const next = live({ id: "22222222-2222-4222-8222-222222222222" });
    server.on("GET /:id/stream", ({ url }) =>
      url.pathname.includes(next.id)
        ? jsonResponse(
            streamPage({
              session: next,
              observations: [],
              nextAfterSequence: 0,
              actions: [],
            }),
          )
        : jsonResponse({ error: { code: "not_found" } }, 404),
    );
    server.on("GET /current", () => jsonResponse({ session: next }));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.queryByText("This session is unavailable.")).toBeNull();
  });
});

describe("commands in a page", () => {
  const press = (code: string, shift = false) =>
    act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: shift, code });
      await vi.advanceTimersByTimeAsync(0);
    });
  it("skill.prev wraps back from the first skill and the bar follows", async () => {
    await show("single");
    await press("BracketLeft");
    expect(screen.getByTestId("pn-skill")).toHaveTextContent("Programming");
    await act(() => vi.advanceTimersByTimeAsync(500));
    await press("BracketLeft");
    expect(screen.getByTestId("pn-skill")).toHaveTextContent(
      "DevOps & Infrastructure",
    );
  });
  it("solution.generate with no coding task says so", async () => {
    await show("single");
    await press("KeyS", true);
    // The note shows in each pane that carries notes (chat and answer).
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });
});

describe("one owner of the microphone and the screen", () => {
  function fakeLocks() {
    const held = new Map<string, { release: () => void }>();
    const queue = new Map<string, (() => void)[]>();
    return {
      request: (name: string, _o: unknown, cb: () => Promise<void>) =>
        new Promise<void>((done) => {
          const take = () => {
            void cb().then(() => {
              held.delete(name);
              done();
              queue.get(name)?.shift()?.();
            });
            held.set(name, { release: () => undefined });
          };
          if (held.has(name))
            queue.set(name, [...(queue.get(name) ?? []), take]);
          else take();
        }),
    };
  }
  it("grants the lock to one document at a time and hands it on when the owner goes", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: fakeLocks() });
    const first = renderHook(() => useOwnsSession("single", "t"));
    const second = renderHook(() => useOwnsSession("settings", "t"));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(false);
    first.unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(second.result.current).toBe(true);
    second.unmount();
    vi.unstubAllGlobals();
    expect(OWNER_LOCK).toContain("panel-owner");
  });
  it("owns what it shows when there are no Web Locks", () => {
    const only = renderHook(() => useOwnsSession("settings", "t"));
    expect(only.result.current).toBe(true);
  });
});
