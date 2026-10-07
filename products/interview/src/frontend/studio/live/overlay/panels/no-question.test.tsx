// A capture with no interview question (D36) in the native window, through the real page and store over a fake server: no task,
// no Problem entry, no answer bubble, a muted note, and the honest line.

import type { LiveAction } from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import {
  type Journey,
  revisionAction,
  startJourney,
} from "../../testing/missing-context-kit";
import { minutesAfter } from "../../testing/session-fixtures";
import { answerResult } from "../../testing/session-result-fixtures";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";
import { pointerOpen } from "./toolbar-test-kit";

let journey: Journey;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const JUNK = "Nothing to answer here, apologies.";

const junkAction = (taskId: string) => ({
  ...revisionAction(taskId, 1),
  noQuestion: true as const,
  result: answerResult({ category: "no-question", draft: JUNK }),
});

async function open(path: string, first: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  window.localStorage.clear();
  window.localStorage.setItem("interview-studio.live.auto.local", "off");
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  journey = startJourney({ first: undefined });
  if (!first) journey.page = { ...journey.page, actions: [] };
  configureSessionStores({
    fetch: journey.server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
  window.history.replaceState({}, "", path);
  render(<OverlayPage />);
  await flush();
  await flush();
}
const publish = async (...actions: LiveAction[]) => {
  for (const each of actions) journey.publish(each);
  await advance(1_500);
};
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete window.studioHost;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const NATIVE = "/t/local/p/interview/live/overlay?panel=single&host=native";

describe("native window", () => {
  it("shows the empty state, a note and the line when every capture had no question", async () => {
    await open(NATIVE, false);
    await publish(junkAction("x"));
    expect(screen.getByTestId("pn-analysis-empty")).toHaveTextContent(
      "Capture screenshot",
    );
    expect(screen.queryByTestId("pn-task-line")).toBeNull();
    expect(screen.getByTestId("pn-no-question")).toHaveTextContent(
      "No question found in the last capture.",
    );
    expect(document.body).not.toHaveTextContent(JUNK);
    expect(
      [...document.querySelectorAll('[data-kind="assistant"]')].length,
    ).toBe(0);
    expect(
      within(screen.getByRole("log")).getByText(/no question found/),
    ).toBeVisible();
  });

  it("offers no Problem entry or Back target for a no-question capture beside real tasks", async () => {
    await open(NATIVE, true);
    await publish(
      { ...revisionAction("task-b", 1), result: answerResult() },
      junkAction("x"),
    );
    // The task bar's Problem menu lists real problems only, newest first.
    pointerOpen(screen.getByTestId("pn-problem-button"));
    const problems = within(
      screen.getByRole("menu", { name: "Problem" }),
    ).getAllByRole("menuitemradio");
    expect(problems.map((item) => item.textContent?.slice(0, 2))).toEqual([
      "T2",
      "T1",
    ]);
    fireEvent.keyDown(screen.getByRole("menu", { name: "Problem" }), {
      key: "Escape",
    });
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T2");
    expect(screen.getByTestId("pn-no-question")).toBeInTheDocument();
  });
});
