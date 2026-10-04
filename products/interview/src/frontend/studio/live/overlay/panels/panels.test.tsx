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
import { answerAction } from "../../live-view-kit";
import {
  action,
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../../session-fixtures";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "../../session-result-fixtures";
import { createTestServer, type TestServer } from "../../session-test-server";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";
import { OWNER_LOCK, useOwnsSession } from "./panel-owner";
import { AnalysisPanel, ChatPanel, type PanelSession } from "./panel-views";
import { RECORDING_LINE, TOAST_MS } from "./use-panel-session";

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
  it("shows the card without a panel, and for an unknown one", async () => {
    window.history.replaceState(
      {},
      "",
      "/t/local/p/interview/live/overlay?panel=nope",
    );
    render(<OverlayPage />);
    await flush();
    await flush();
    expect(screen.getByTestId("overlay-card")).toBeVisible();
    expect(screen.queryByTestId("pn-root")).toBeNull();
  });
});

const HOST_BASE = {
  capabilities: ["multi-panel", "click-through"],
  open: async () => true,
  close: async () => true,
  focus: async () => true,
  openPanels: () => ["pill"],
  setLayout: async () => true,
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

describe("bar", () => {
  it("shows the camera with its hotkey, the mic, the skill name and a dot, and nothing else", async () => {
    await show("pill");
    expect(
      screen.getByRole("button", { name: "Capture screenshot" }),
    ).toHaveTextContent("⌘⇧S");
    expect(
      screen.getByRole("button", { name: "Start microphone" }),
    ).toBeVisible();
    expect(screen.getByTestId("pn-skill")).toHaveTextContent("DSA");
    expect(screen.getByTestId("pn-dot")).toHaveAttribute("data-tone", "green");
    const bar = screen.getByTestId("pn-pill");
    expect(within(bar).getAllByRole("button")).toHaveLength(2);
    for (const gone of [/Auto/, /Remote/, /Visible window/, /companion/i])
      expect(bar).not.toHaveTextContent(gone);
  });
  it("follows the skill and goes red when interaction is off", async () => {
    const host = nativeHost();
    await show("pill", "&host=native");
    await host.set(false);
    expect(screen.getByTestId("pn-dot")).toHaveAttribute("data-tone", "red");
    await host.set(true);
    expect(screen.getByTestId("pn-dot")).toHaveAttribute("data-tone", "green");
  });
});

describe("analysis", () => {
  it("is quiet before anything is captured", async () => {
    serve(live(), []);
    await show("analysis");
    expect(screen.getByTestId("pn-analysis-empty")).toBeVisible();
    expect(screen.queryByTestId("pn-code")).toBeNull();
  });
  it("shows the problem analysis in a text column and the code in a separate card", async () => {
    serve(live(), codingActions());
    await show("analysis");
    expect(screen.getByTestId("pn-problem")).toHaveTextContent(
      "Implement a rate limiter for a Node service Problem Analysis",
    );
    expect(screen.getByText("Problem Type:")).toBeVisible();
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
  it("has none of the old chrome: tabs, slots, revisions, run, activity, workspace", async () => {
    serve(live(), codingActions());
    await show("analysis");
    const panel = screen.getByTestId("pn-analysis");
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
  it("shows Analyzing while a capture is in flight, in place of the old answer", () => {
    const session = {
      selected: undefined,
      phase: "analyzing",
      note: null,
    } as unknown as PanelSession;
    render(<AnalysisPanel s={session} />);
    expect(screen.getByTestId("pn-analyzing")).toHaveTextContent("Analyzing");
    expect(screen.queryByTestId("pn-answer")).toBeNull();
  });
});

describe("chat", () => {
  it("has the header, the input, the red mic and send, and lists a typed message as a card", async () => {
    await show("chat");
    expect(screen.getByText("Live Transcription & Chat")).toBeVisible();
    expect(
      screen.getByPlaceholderText("Type a message or transcription…"),
    ).toBeVisible();
    expect(screen.queryByTestId("pn-rec")).toBeNull();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "and the cost?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(submitFollowUp).toHaveBeenCalledTimes(1);
    const card = screen.getByText("and the cost?").closest(".pn-row");
    expect(card).toHaveAttribute("data-kind", "typed");
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });
  it("shows the assistant reply as a purple card with the answer's lines", async () => {
    serve(live(), codingActions());
    await show("chat");
    const card = document.querySelector('.pn-row[data-kind="assistant"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).not.toBe("…");
  });
  it("says Session memory has been cleared as a system line", async () => {
    await show("chat");
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyC" });
      await vi.advanceTimersByTimeAsync(0);
    });
    const line = screen.getByText("Session memory has been cleared");
    expect(line.closest(".pn-row")).toHaveAttribute("data-kind", "system");
  });
  it("shows a red dot, the recording line, the interim words and a loading reply", () => {
    const session = {
      model: { transcript: [], tasks: [] },
      entries: [],
      system: [{ key: "r", text: RECORDING_LINE, at: 5 }],
      clearedAt: 0,
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
    expect(screen.getByTestId("pn-rec")).toHaveAttribute("data-tone", "red");
    expect(screen.getByText(RECORDING_LINE)).toBeVisible();
    expect(screen.getByTestId("pn-interim")).toHaveTextContent(
      "OK can you explain the",
    );
    expect(screen.getByTestId("pn-loading")).toHaveTextContent("…");
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
  it("Quit asks the shell to quit, and Close closes the panel through the host", async () => {
    const quit = vi.fn();
    const close = vi.fn(async () => true);
    nativeHost({ close }, { quit });
    await show("settings", "&host=native");
    fireEvent.click(screen.getByTestId("pn-quit"));
    expect(quit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("pn-close"));
    await flush();
    expect(close).toHaveBeenCalledWith("settings");
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
  // The analysis panel draws them by default; each text is exact.
  const toasts = () => screen.getByTestId("pn-toasts");
  it("says Interaction Mode ON and OFF with the exact words", async () => {
    const host = nativeHost();
    await show("analysis", "&host=native");
    await host.set(false);
    expect(toasts()).toHaveTextContent("Interaction Mode: OFF");
    expect(toasts()).toHaveTextContent("Red dot shows interaction mode is off");
    await host.set(true);
    expect(toasts()).toHaveTextContent("Interaction Mode: ON");
    expect(toasts()).toHaveTextContent(
      "Green dot, Interact with window like scroll, copy, move",
    );
  });
  it("says Skill changed to - <Skill> when a skill is picked", async () => {
    await show("analysis");
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, code: "BracketRight" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toasts()).toHaveTextContent("Skill changed to - System Design");
    expect(toasts()).toHaveTextContent("Look in the small tab above");
  });
  it("says Current Skill when interaction mode is off and the skill is not changed", async () => {
    const host = nativeHost();
    await show("analysis", "&host=native");
    await host.set(false);
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, code: "BracketRight" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toasts()).toHaveTextContent(
      "Current Skill - Data Structures & Algorithms",
    );
    expect(toasts()).toHaveTextContent(
      "Change Skill: Cmd + Arrow Up/Down (Only in interaction mode)",
    );
    expect(
      window.localStorage.getItem(
        "interview-studio.live.capture-settings.local",
      ),
    ).toBeNull();
  });
  it("auto-hides after about three seconds", async () => {
    const host = nativeHost();
    await show("analysis", "&host=native");
    await host.set(false);
    expect(toasts()).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(TOAST_MS + 50));
    expect(screen.queryByTestId("pn-toasts")).toBeNull();
  });
  it("does not draw them when the shell does (nativeToasts), or in a panel that is not the toast document", async () => {
    const host = nativeHost({ nativeToasts: true });
    await show("analysis", "&host=native");
    await host.set(false);
    expect(screen.queryByTestId("pn-toasts")).toBeNull();
    cleanup();
    const other = nativeHost();
    await show("chat", "&host=native");
    await other.set(false);
    expect(screen.queryByTestId("pn-toasts")).toBeNull();
    cleanup();
    const named = nativeHost();
    await show("chat", "&host=native&toasts=1");
    await named.set(false);
    expect(toasts()).toHaveTextContent("Interaction Mode: OFF");
  });
});

describe("auto-session in a native panel", () => {
  const noSession = () =>
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
  it("starts one with the defaults once the shell has recorded consent, never saying 'Start one in Studio'", async () => {
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
    await show("pill", "&host=native");
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(started).toEqual([
      {
        processingPolicy: "permitted-remote",
        captureSources: ["microphone", "application-audio", "screen"],
      },
    ]);
    expect(screen.queryByText(/Start one in Studio/)).toBeNull();
  });
  it("shows one Consent required line with a button that opens the shell's consent, and starts nothing", async () => {
    noSession();
    const open = vi.fn(async () => undefined);
    nativeHost({}, { consent: { granted: () => false, open } });
    await show("analysis", "&host=native");
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText("Consent required")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review consent" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });
});

describe("commands in a page", () => {
  const press = (code: string, shift = false) =>
    act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: shift, code });
      await vi.advanceTimersByTimeAsync(0);
    });
  it("skill.prev wraps back from the first skill and the bar follows", async () => {
    await show("pill");
    await press("BracketLeft");
    expect(screen.getByTestId("pn-skill")).toHaveTextContent("Programming");
    await act(() => vi.advanceTimersByTimeAsync(500));
    await press("BracketLeft");
    expect(screen.getByTestId("pn-skill")).toHaveTextContent(
      "DevOps & Infrastructure",
    );
  });
  it("solution.generate with no coding task says so", async () => {
    await show("analysis");
    await press("KeyS", true);
    expect(screen.getByRole("alert")).toBeDefined();
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
    const first = renderHook(() => useOwnsSession("pill", "t"));
    const second = renderHook(() => useOwnsSession("chat", "t"));
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
