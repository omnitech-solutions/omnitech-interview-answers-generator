import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActions } from "../session-snapshot";
import { Footer, type FooterVariant } from "./overlay-footer";
import { PAUSED_NOTICE } from "./panels/strip-model";

// The build the footer's tag reads: set per test (a packaged app shows no tag).
const build = vi.hoisted(() => ({
  BUILD_ID: "abc1234+",
  BUILD: {
    id: "abc1234+",
    sha: "abc1234def5678901234567890123456789abcd",
    branch: "native-swap",
    packaged: false,
  },
}));
vi.mock("./build-id", () => build);

afterEach(() => {
  cleanup();
  build.BUILD.packaged = false;
});

function actions(overrides: Partial<SessionActions> = {}) {
  const ok = vi.fn(async () => ({ ok: true as const }));
  return {
    pause: ok,
    resume: vi.fn(async () => ({ ok: true as const })),
    end: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  } as unknown as SessionActions & {
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function show(
  variant: FooterVariant,
  options: {
    wording?: "short" | "session";
    pending?: string[];
    actions?: SessionActions;
    onFailure?: (code: string) => void;
  } = {},
) {
  const run = options.actions ?? actions();
  render(
    <Footer
      variant={variant}
      wording={options.wording ?? "session"}
      pending={options.pending ?? []}
      actions={run}
      onFailure={(options.onFailure ?? vi.fn()) as never}
    />,
  );
  return run;
}

const live = (paused = false): FooterVariant => ({
  kind: "live",
  paused,
  clock: { label: "1:00" },
});

describe("footer", () => {
  it("offers Pause and End while live, spelled by the wording", () => {
    show(live());
    expect(screen.getByRole("button", { name: "Pause session" })).toBeVisible();
    expect(screen.getByRole("button", { name: "End session" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
  });

  it("uses the short wording in the overlay", () => {
    show(live(), { wording: "short" });
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
    expect(screen.getByRole("button", { name: "End" })).toBeVisible();
  });

  it("pauses through the session actions", async () => {
    const run = show(live());
    fireEvent.click(screen.getByRole("button", { name: "Pause session" }));
    await waitFor(() => expect(run.pause).toHaveBeenCalledTimes(1));
  });

  it("shows one Resume while paused, in the Pause place, and resumes", async () => {
    const run = show(live(true));
    expect(screen.queryByRole("button", { name: /^Pause/ })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Resume session" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
    await waitFor(() => expect(run.resume).toHaveBeenCalledTimes(1));
  });

  it("disables Pause and Resume while one is in flight", () => {
    show(live(), { pending: ["pause"] });
    expect(
      screen.getByRole("button", { name: "Pause session" }),
    ).toBeDisabled();
  });

  it("reports a refused command through onFailure", async () => {
    const onFailure = vi.fn();
    const run = actions({
      pause: vi.fn(async () => ({
        ok: false as const,
        code: "status_refused" as const,
      })),
    });
    show(live(), { actions: run, onFailure });
    fireEvent.click(screen.getByRole("button", { name: "Pause session" }));
    await waitFor(() =>
      expect(onFailure).toHaveBeenCalledWith("status_refused"),
    );
  });

  it("asks before ending: Keep going leaves the session as it was", async () => {
    const run = show(live());
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(screen.getByText(/Capture stops and running work/)).toBeVisible();
    expect(run.end).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    await waitFor(() => expect(screen.queryByText(/Capture stops/)).toBeNull());
    expect(run.end).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End session" })).toHaveFocus();
  });

  it("closes the confirmation on Escape and returns focus to End", async () => {
    const run = show(live());
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    const keep = screen.getByRole("button", { name: "Keep going" });
    await waitFor(() => expect(keep).toHaveFocus());
    fireEvent.keyDown(keep, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/Capture stops/)).toBeNull());
    expect(run.end).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End session" })).toHaveFocus();
  });

  it("ends only on End now", async () => {
    const run = show(live());
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    fireEvent.click(screen.getByRole("button", { name: "End now" }));
    await waitFor(() => expect(run.end).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/Capture stops/)).toBeNull());
  });

  it("shows the session clock with its paused wording", () => {
    show(live(true));
    const clock = screen.getByRole("timer");
    expect(clock).toHaveTextContent("1:00");
    // "Paused" is said twice in the footer (the clock and the microphone line):
    // the clock's own word sits in its paused slot.
    expect(
      document.querySelector('[data-slot="status-clock-paused"]'),
    ).toHaveTextContent("Paused");
  });

  it("offers a new session and the summary once ended, not Pause or End", () => {
    const onStart = vi.fn();
    const onOpenSummary = vi.fn();
    show({ kind: "ended", starting: false, onStart, onOpenSummary });
    expect(screen.queryByRole("button", { name: /Pause|End/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open summary" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Start a new session" }),
    );
    expect(onOpenSummary).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("has no summary button without a summary, and locks Start while starting", () => {
    show({ kind: "ended", starting: true, onStart: vi.fn() });
    expect(screen.queryByRole("button", { name: "Open summary" })).toBeNull();
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  });

  it("shows only the status line, with no session buttons, before a session", () => {
    show({ kind: "idle", status: <span>Not signed in</span> });
    expect(screen.getByText("Not signed in")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Pause|Resume|End|Start/ }),
    ).toBeNull();
  });

  it("has no Live text: a record mark and the time, nothing else", () => {
    show(live());
    const clock = screen.getByRole("group", { name: "Session time 1:00" });
    expect(clock).toHaveAttribute("data-state", "live");
    expect(clock).not.toHaveTextContent(/Live/);
    expect(clock).toHaveTextContent(/^1:00/);
    expect(
      clock.querySelector('[data-slot="status-clock-icon"]'),
    ).not.toBeNull();
  });

  it("says Paused with the pause icon and keeps the explanation as its tooltip", () => {
    show(live(true));
    const clock = screen.getByRole("group", {
      name: "Session time 1:00, paused",
    });
    expect(clock).toHaveAttribute("data-state", "paused");
    expect(clock).toHaveTextContent("Paused");
    expect(clock).toHaveAttribute("title", PAUSED_NOTICE.sub);
  });

  it("swaps Pause for Resume in one slot and never changes the bar's surface", () => {
    show(live());
    const bar = screen.getByRole("toolbar", { name: "Session footer" });
    const liveClass = bar.className;
    expect(
      document.querySelector('[data-slot="session-pause"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-slot="session-resume"]')).toBeNull();
    cleanup();
    show(live(true));
    const paused = screen.getByRole("toolbar", { name: "Session footer" });
    expect(paused.className).toBe(liveClass);
    expect(
      document.querySelector('[data-slot="session-resume"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-slot="session-pause"]')).toBeNull();
  });

  it("holds only the clock and the session buttons", () => {
    show(live());
    const bar = screen.getByRole("toolbar", { name: "Session footer" });
    expect(
      [...bar.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual([
      `${build.BUILD.id} · ${build.BUILD.branch}`,
      "Pause session",
      "End session",
    ]);
  });

  it("shows the development build tag with the full commit as its tooltip and copies it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    show(live());
    const tag = screen.getByRole("button", { name: /^Copy build/ });
    expect(tag).toHaveTextContent("abc1234+");
    expect(tag).toHaveTextContent("native-swap");
    expect(tag).toHaveAttribute("title", build.BUILD.sha);
    fireEvent.click(tag);
    expect(writeText).toHaveBeenCalledWith(build.BUILD.sha);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copied" })).toBeVisible(),
    );
  });

  describe("Record transcript", () => {
    const SESSION = "5e551011-0000-4000-8000-00000000000a";
    const record = () => screen.queryByTestId("pn-record-transcript");
    const liveWith = (
      sessionId: string | null | undefined,
      paused = false,
    ): FooterVariant => ({
      kind: "live",
      paused,
      clock: { label: "1:00" },
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    afterEach(() => vi.unstubAllGlobals());

    it("is offered for a live session that names itself: off, before Pause and End", () => {
      show(liveWith(SESSION));
      expect(record()).toHaveTextContent("Record transcript");
      expect(record()).toHaveAttribute("data-recording", "off");
      expect(record()).toHaveAttribute("aria-pressed", "false");
      expect(record()).toBeEnabled();
      const names = screen
        .getAllByRole("button")
        .map((button) => button.textContent);
      expect(names.slice(-3)).toEqual([
        "Record transcript",
        "Pause session",
        "End session",
      ]);
    });

    it.each([
      ["a live session that names none", liveWith(undefined)],
      ["a live session whose id is not known yet", liveWith(null)],
      ["a live session with an empty id", liveWith("")],
      ["an idle window", { kind: "idle", status: <span>Not signed in</span> }],
    ] as [string, FooterVariant][])(
      "is not offered for %s",
      (_name, variant) => {
        show(variant);
        expect(record()).toBeNull();
      },
    );

    it("cannot be pressed while the session is paused, beside Resume", () => {
      show(liveWith(SESSION, true));
      expect(record()).toBeDisabled();
      expect(record()).toHaveAttribute("data-recording", "off");
      expect(
        screen.getByRole("button", { name: "Resume session" }),
      ).toBeEnabled();
    });

    it("starts the recording of the session the footer was given", async () => {
      const asked: { url: string; method?: string; body?: unknown }[] = [];
      // The server's side: off until asked, as the window reads on opening.
      let held: { on: boolean; lines: number; file?: string } = {
        on: false,
        lines: 0,
      };
      vi.stubGlobal(
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "null"));
          asked.push({
            url: String(input),
            ...(init?.method ? { method: init.method } : {}),
            body,
          });
          if (init?.method === "POST")
            held = { on: body.on === true, lines: 0, file: "f.txt" };
          return new Response(
            JSON.stringify({
              recording: held,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      );
      show(liveWith(SESSION));
      fireEvent.click(record() as HTMLElement);
      await waitFor(() =>
        expect(record()).toHaveAttribute("data-recording", "on"),
      );
      expect(record()).toHaveTextContent("Recording · 0 lines");
      // The read on opening, then the press.
      expect(asked).toEqual([
        {
          url: `/api/interview/t/local/sessions/${SESSION}/recording`,
          body: null,
        },
        {
          url: `/api/interview/t/local/sessions/${SESSION}/recording`,
          method: "POST",
          body: { on: true },
        },
      ]);
      // Pause and End are still there beside it.
      expect(
        screen.getByRole("button", { name: "Pause session" }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "End session" })).toBeVisible();
    });
  });

  it("shows no build tag in a packaged app", () => {
    build.BUILD.packaged = true;
    show(live());
    expect(screen.queryByRole("button", { name: /^Copy build/ })).toBeNull();
    cleanup();
    show({ kind: "idle", status: <span>Not signed in</span> });
    expect(screen.queryByRole("button", { name: /^Copy build/ })).toBeNull();
  });
});
