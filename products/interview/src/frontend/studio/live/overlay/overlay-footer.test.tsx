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

afterEach(cleanup);

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
  clock: { label: "1:00", paused },
  notice: paused ? PAUSED_NOTICE : null,
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
    expect(screen.getByText("Paused")).toBeVisible();
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
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
