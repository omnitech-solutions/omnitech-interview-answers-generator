// The Revisions control and the follow-up line on the compact card: the card's
// task head, answer and composer follow the revision on show.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../session-registry";
import {
  CUT_OFF_TASK,
  type Journey,
  startJourney,
} from "../testing/missing-context-kit";
import { minutesAfter } from "../testing/session-fixtures";
import { OverlayPage } from "./overlay-page";

let journey: Journey;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  window.localStorage.clear();
  window.localStorage.setItem("interview-studio.live.auto.local", "off");
  resetSessionStores();
  presentation.reset();
  journey = startJourney({ first: undefined });
  configureSessionStores({
    fetch: journey.server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
  window.history.replaceState({}, "", "/t/local/p/interview/live/overlay");
  render(<OverlayPage />);
  await flush();
  await flush();
  journey.publish(
    journey.revision(
      { taskId: CUT_OFF_TASK, revision: 2 },
      { draft: "Second take." },
    ),
  );
  await advance(1_500);
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the card", () => {
  it("shows the current revision, lists both and swaps the answer", () => {
    const card = screen.getByTestId("overlay-card");
    expect(screen.getByTestId("task-tag")).toHaveTextContent("T1 · rev 2 of 2");
    expect(card).toHaveTextContent("Second take.");
    fireEvent.click(screen.getByTestId("revisions-button"));
    expect(screen.getByTestId("revision-2")).toHaveTextContent(
      "rev 2 · Current",
    );
    expect(screen.getByTestId("revision-1")).toHaveTextContent(
      "rev 1 · Outdated",
    );
    fireEvent.click(screen.getByTestId("revision-1"));
    expect(screen.getByTestId("task-tag")).toHaveTextContent("T1 · rev 1 of 2");
    expect(card).toHaveTextContent("First read of the cut-off problem.");
    expect(card).not.toHaveTextContent("Second take.");
    expect(screen.getByTestId("ov-earlier-revision")).toHaveTextContent(
      "current is rev 2",
    );
  });

  it("says where a follow-up goes while an older revision is on show", () => {
    expect(screen.queryByTestId("ov-followup-note")).toBeNull();
    fireEvent.click(screen.getByTestId("revisions-button"));
    fireEvent.click(screen.getByTestId("revision-1"));
    expect(screen.getByTestId("ov-followup-note")).toHaveTextContent(
      "Follow-up goes to rev 2",
    );
  });
});
