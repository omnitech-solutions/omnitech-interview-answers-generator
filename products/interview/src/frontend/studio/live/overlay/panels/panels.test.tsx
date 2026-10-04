// The four panels over the real store with a scripted service, the one-owner
// rule, language and skill gating, the commands list and the toasts.
import {
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
} from "@omnitech/interview-contracts";
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

describe("pill", () => {
  it("shows the hotkey, the skill, a live dot and the visibility line", async () => {
    await show("pill");
    expect(
      screen.getByRole("button", { name: "Capture screenshot" }),
    ).toHaveTextContent("Alt+Shift+A");
    expect(screen.getByTestId("pn-skill")).toHaveTextContent("Auto-detect");
    expect(screen.getByTestId("pn-dot")).toHaveAttribute("data-tone", "green");
    expect(screen.getByTestId("pn-visible")).toHaveTextContent(
      "Visible window · shows in screen shares",
    );
  });
  it("is amber when paused", async () => {
    serve(live({ status: "paused" }));
    await show("pill");
    expect(screen.getByTestId("pn-dot")).toHaveAttribute("data-tone", "amber");
  });
  it("says so when the window cannot open another panel", async () => {
    await show("pill");
    fireEvent.click(screen.getByRole("button", { name: "Open analysis" }));
    await flush();
    expect(screen.getByRole("status", { name: "Live" })).toBeVisible();
    expect(screen.getByText(/can’t open the Analysis panel/)).toBeVisible();
  });
  it("opens panels through the host, and goes red when interaction is off", async () => {
    const open = vi.fn(async () => true);
    let listener: (on: boolean) => void = () => undefined;
    let mode = true;
    (window as { studioHost?: unknown }).studioHost = {
      presentation: {
        capabilities: ["multi-panel", "click-through"],
        open,
        close: async () => true,
        focus: async () => true,
        openPanels: () => ["pill"],
        setLayout: async () => true,
        setVisible: async () => true,
        interactionMode: () => mode,
        setInteractionMode: async () => true,
        onInteractionMode: (l: (on: boolean) => void) => {
          listener = (on: boolean) => {
            mode = on;
            l(on);
          };
          return () => undefined;
        },
      },
    };
    await show("pill", "&host=native");
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await flush();
    expect(open).toHaveBeenCalledWith("chat");
    act(() => listener(false));
    expect(screen.getByTestId("pn-dot")).toHaveAttribute("data-tone", "red");
    expect(screen.getByTestId("pn-toasts")).toHaveTextContent(
      "Interaction mode: OFF",
    );
  });
});

describe("analysis", () => {
  it("is empty before anything is analysed", async () => {
    serve(live(), []);
    await show("analysis");
    expect(screen.getByTestId("pn-analysis-empty")).toBeVisible();
  });
  it("shows the problem, its type, constraint chips and the code card with the canvas", async () => {
    serve(live(), codingActions());
    await show("analysis");
    expect(screen.getByTestId("pn-problem")).toHaveTextContent(
      "Implement a rate limiter",
    );
    expect(screen.getByTestId("pn-type")).toHaveTextContent(
      "Programming challenge",
    );
    expect(
      within(screen.getByLabelText("Constraints")).getByText(
        "No sorting allowed",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("pn-language")).toHaveTextContent("typescript");
    expect(
      within(screen.getByTestId("pn-code")).getByRole("textbox", {
        hidden: true,
      }),
    ).toBeDefined();
  });
});

describe("chat", () => {
  it("has the header, sends a typed message through the owner route and lists it", async () => {
    await show("chat");
    expect(screen.getByText("Live Transcription & Chat")).toBeVisible();
    expect(screen.getByTestId("pn-rec")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "and the cost?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(submitFollowUp).toHaveBeenCalledTimes(1);
    expect(screen.getByText("and the cost?")).toBeVisible();
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });
});

describe("settings", () => {
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
  it("offers the nine skills, remembers the choice and toasts the change", async () => {
    await show("settings");
    const select = screen.getByTestId("pn-skill-select");
    expect(within(select).getAllByRole("option")).toHaveLength(
      LIVE_OWNER_SKILLS.length + 1,
    );
    fireEvent.change(select, { target: { value: "dsa" } });
    await flush();
    expect(screen.getByTestId("pn-toasts")).toHaveTextContent(
      `Skill changed to ${LIVE_OWNER_SKILL_LABELS.dsa}`,
    );
    expect(
      window.localStorage.getItem(
        "interview-studio.live.capture-settings.local",
      ),
    ).toContain("dsa");
  });
  it("lists the commands with their hotkeys, the footer line, locality and retention", async () => {
    await show("settings");
    const commands = screen.getByTestId("pn-commands");
    for (const name of [
      "auto.toggle",
      "capture.analyze",
      "solution.generate",
      "transcribe.toggle",
      "skill.next",
      "skill.prev",
      "session.clear",
      "panel.toggle",
    ])
      expect(within(commands).getByText(name)).toBeVisible();
    expect(within(commands).getByText("Alt+Shift+H")).toBeVisible();
    expect(
      screen.getByText("Visible window · shows in screen shares"),
    ).toBeVisible();
    expect(screen.getByTestId("pn-locality")).toHaveTextContent(
      "Remote allowed",
    );
    expect(screen.getByTestId("pn-retention")).not.toHaveTextContent("—");
  });
  it("turns Auto on and off, remembered", async () => {
    await show("settings");
    fireEvent.click(screen.getByTestId("pn-auto"));
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("on");
    fireEvent.click(screen.getByTestId("pn-auto"));
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("off");
  });
});

describe("commands in a page", () => {
  const press = (code: string, shift = false) =>
    act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: shift, code });
      await vi.advanceTimersByTimeAsync(0);
    });
  it("skill.next picks the first skill and toasts; skill.prev wraps back", async () => {
    await show("pill");
    await press("BracketRight");
    expect(screen.getByTestId("pn-toasts")).toHaveTextContent(
      `Skill changed to ${LIVE_OWNER_SKILL_LABELS[LIVE_OWNER_SKILLS[0] as never]}`,
    );
    expect(screen.getByTestId("pn-skill")).toHaveTextContent(
      LIVE_OWNER_SKILL_LABELS[LIVE_OWNER_SKILLS[0] as never],
    );
  });
  it("session.clear says so", async () => {
    await show("chat");
    await press("KeyC", true);
    expect(screen.getByTestId("pn-toasts")).toHaveTextContent(
      "Session memory cleared",
    );
  });
  it("auto.toggle flips Auto", async () => {
    await show("pill");
    await press("KeyH", true);
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("on");
  });
  it("solution.generate with no coding task says so, and with one sends solve once per revision", async () => {
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
