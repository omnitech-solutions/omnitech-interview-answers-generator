import type { CoachNote } from "@omnitech/interview-contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallSlot, ConversationView } from "./conversation-view";
import type { PanelRow } from "./panel-model";

const T0 = Date.parse("2026-10-08T17:40:00.000Z");
const QUESTION_ONE =
  "How do you decide when a feature should be a microservice";
const QUESTION_TWO =
  "How do you handle data consistency between multiple services";
const heard = (
  speaker: "interviewer" | "you",
  seconds: number,
  text: string,
): PanelRow => ({
  key: `${speaker}-${seconds}`,
  kind: "heard",
  speaker,
  label: speaker,
  text,
  at: T0 + seconds * 1000,
});
const note = (seconds: number, title: string, markdown: string): CoachNote => ({
  id: `00000000-0000-4000-8000-${String(seconds).padStart(12, "0")}`,
  createdAt: new Date(T0 + seconds * 1000).toISOString(),
  title,
  tone: "say",
  points: [],
  markdown,
  links: [],
});
const ROWS = [
  heard("interviewer", 0, QUESTION_ONE),
  heard("you", 10, "I default to the monolith"),
  heard("interviewer", 60, QUESTION_TWO),
];
const NOTES = [
  note(20, "Monolith or service", "Name the **criteria**"),
  note(80, "Consistency", "Say **outbox**"),
];

function show(notes: readonly CoachNote[] = NOTES, onSelectTask = vi.fn()) {
  render(
    <ConversationView
      rows={ROWS}
      notes={notes}
      interim=""
      selectedTaskId={undefined}
      onSelectTask={onSelectTask}
    />,
  );
}

afterEach(() => window.localStorage.clear());

describe("ConversationView", () => {
  it("pins the question on the table and lists every question as a turn", () => {
    show();

    expect(screen.getByTestId("pn-conversation-current")).toHaveTextContent(
      QUESTION_TWO,
    );
    expect(
      screen
        .getAllByTestId("pn-conversation-question")
        .map((each) => each.textContent),
    ).toEqual([QUESTION_ONE, QUESTION_TWO]);
  });

  it("puts each note under its question, the current one open and earlier ones folded", () => {
    show();

    const [first, second] = screen.getAllByTestId("pn-conversation-turn");
    expect(
      within(first as HTMLElement).getByRole("button", {
        name: "Monolith or service",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(second as HTMLElement).getByText("outbox")).toBeVisible();
    expect(screen.queryByText("criteria")).toBeNull();
  });

  it("opens a folded note when its title is pressed", () => {
    show();

    fireEvent.click(
      screen.getByRole("button", { name: "Monolith or service" }),
    );

    expect(screen.getByText("criteria")).toBeVisible();
  });

  it("says what will appear before anything is heard", () => {
    render(
      <ConversationView
        rows={[]}
        notes={[]}
        interim=""
        selectedTaskId={undefined}
        onSelectTask={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Questions appear here as they are asked",
    );
  });
});

describe("CallSlot", () => {
  it("is resized from its bar with the arrow keys, down to nothing, and keeps the height", () => {
    const { unmount } = render(<CallSlot />);
    const bar = screen.getByRole("slider", {
      name: "Height of the room for the call window",
    });
    const before = Number(bar.getAttribute("aria-valuenow"));

    fireEvent.keyDown(bar, { key: "ArrowDown" });
    expect(Number(bar.getAttribute("aria-valuenow"))).toBe(before + 24);

    fireEvent.keyDown(bar, { key: "Home" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(bar, { key: "ArrowDown" });
    unmount();
    render(<CallSlot />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "24");
  });

  it("follows a drag of its bar", () => {
    render(<CallSlot />);
    const bar = screen.getByRole("slider");
    const before = Number(bar.getAttribute("aria-valuenow"));

    fireEvent.pointerDown(bar, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(bar, { pointerId: 1 });

    expect(Number(bar.getAttribute("aria-valuenow"))).toBe(before + 60);
  });
});
