// The Revisions control in the native window, through the real page and store
// over a fake server: one task with several revisions is ONE chat row, the
// answer pane, the code, the constraints and the row's text follow the
// revision on show, the earlier-TASK control stays separate, and a follow-up
// still goes to the task's current revision.
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
  CUT_OFF_TASK,
  type Journey,
  startJourney,
} from "../../testing/missing-context-kit";
import { minutesAfter } from "../../testing/session-fixtures";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";

let journey: Journey;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const FIRST = "First read of the cut-off problem.";
const SECOND = "Revised with the added context.";
const THIRD = "A third take.";

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
const answer = () => screen.getByTestId("pn-answer");
// The chat's rows for assistant answers: a task is exactly one.
const chatRows = () =>
  [
    ...document.querySelectorAll(
      '[data-testid="pn-chat"] [data-kind="assistant"]',
    ),
  ]
    .filter((row) => row.getAttribute("data-testid") !== "pn-loading")
    .map((row) => row.textContent ?? "");
const revisionsButton = () => screen.getByTestId("revisions-button");
const openList = () => fireEvent.click(revisionsButton());
const choose = (revision: number) => {
  openList();
  fireEvent.click(screen.getByTestId(`revision-${revision}`));
};
const publish = async (revision: number, draft: string) => {
  journey.publish(
    journey.revision({ taskId: CUT_OFF_TASK, revision }, { draft }),
  );
  await advance(1_500);
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  window.localStorage.clear();
  window.localStorage.setItem("interview-studio.live.auto.local", "off");
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  serve(startJourney({ first: undefined }));
  await open();
  await publish(2, SECOND);
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete window.studioHost;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the Revisions control", () => {
  it("names the revision on show and lists every revision, the current one marked", () => {
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent(
      "T1 · rev 2 of 2",
    );
    expect(revisionsButton()).toHaveAccessibleName("Revisions: rev 2 of 2");
    openList();
    const menu = screen.getByRole("menu", { name: "Revisions" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("data-testid"))).toEqual([
      "revision-2",
      "revision-1",
    ]);
    expect(items[0]).toHaveTextContent("rev 2 · Current");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[1]).toHaveTextContent("rev 1 · Outdated");
    expect(items[1]).toHaveTextContent("First answer");
    expect(items[0]).toHaveTextContent("Follow-up");
    expect(items[1]).toHaveAttribute("aria-checked", "false");
  });

  it("is operable from the keyboard", () => {
    openList();
    const menu = screen.getByRole("menu", { name: "Revisions" });
    // Opening puts focus on the revision on show.
    expect(screen.getByTestId("revision-2")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByTestId("revision-1")).toHaveFocus();
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.queryByRole("menu", { name: "Revisions" })).toBeNull();
    expect(revisionsButton()).toHaveFocus();
    expect(answer()).toHaveTextContent(FIRST);
  });

  it("closes on Escape without changing the revision", () => {
    openList();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Revisions" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("menu", { name: "Revisions" })).toBeNull();
    expect(answer()).toHaveTextContent(SECOND);
  });
});

describe("choosing a revision", () => {
  it("swaps the answer and the task's one chat row, and says it is earlier", () => {
    expect(chatRows()).toHaveLength(1);
    expect(chatRows()[0]).toContain(SECOND);
    choose(1);
    expect(answer()).toHaveTextContent(FIRST);
    expect(answer()).not.toHaveTextContent(SECOND);
    expect(chatRows()).toHaveLength(1);
    expect(chatRows()[0]).toContain(FIRST);
    expect(chatRows()[0]).not.toContain(SECOND);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent(
      "T1 · rev 1 of 2",
    );
    expect(screen.getByTestId("pn-earlier-revision")).toHaveTextContent(
      "viewing an earlier revision · current is rev 2",
    );
    // It is not the earlier-TASK control.
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
    choose(2);
    expect(answer()).toHaveTextContent(SECOND);
    expect(chatRows()[0]).toContain(SECOND);
    expect(screen.queryByTestId("pn-earlier-revision")).toBeNull();
  });

  it("keeps an old revision when a newer one arrives, and says so", async () => {
    choose(1);
    await publish(3, THIRD);
    expect(answer()).toHaveTextContent(FIRST);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("rev 1 of 3");
    expect(screen.getByTestId("pn-earlier-revision")).toHaveTextContent(
      "current is rev 3",
    );
    expect(chatRows()[0]).toContain(FIRST);
  });

  it("follows the newest revision when the current one was on show", async () => {
    await publish(3, THIRD);
    expect(answer()).toHaveTextContent(THIRD);
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("rev 3 of 3");
    expect(chatRows()).toHaveLength(1);
    expect(chatRows()[0]).toContain(THIRD);
    expect(screen.queryByTestId("pn-earlier-revision")).toBeNull();
  });
});

describe("the follow-up box", () => {
  it("says where a follow-up goes while an older revision is on show, and sends it to the current one", async () => {
    expect(screen.queryByTestId("pn-followup-note")).toBeNull();
    choose(1);
    expect(screen.getByTestId("pn-followup-note")).toHaveTextContent(
      "Follow-up goes to rev 2",
    );
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "and the edge cases?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(journey.inputs[0]).toMatchObject({
      target: { taskId: CUT_OFF_TASK, revision: 2 },
    });
  });
});

describe("a revision with no text yet", () => {
  const publishRaw = async (over: Record<string, unknown>) => {
    journey.publish({
      ...journey.revision({ taskId: CUT_OFF_TASK, revision: 3 }),
      ...over,
    } as never);
    await advance(1_500);
  };

  it("shows its own state while drafting, never the other revision's text", async () => {
    await publishRaw({ dispatchStatus: "in_flight", result: null });
    expect(chatRows()).toHaveLength(1);
    expect(chatRows()[0]).not.toContain(SECOND);
    expect(chatRows()[0]).not.toContain(FIRST);
    expect(chatRows()[0]).toContain("…");
    // The older revision still reads as itself.
    choose(2);
    expect(chatRows()[0]).toContain(SECOND);
  });

  it("says why a draft the guard withheld has no text", async () => {
    await publishRaw({
      dispatchStatus: "suppressed",
      suppressionReason: "invalid_output",
      result: { withheld: { rejectedClaimCount: 2, codes: [] } },
    });
    expect(chatRows()).toHaveLength(1);
    expect(chatRows()[0]).not.toContain(SECOND);
    expect(chatRows()[0]).toMatch(/withheld|checked|claim/i);
  });
});
