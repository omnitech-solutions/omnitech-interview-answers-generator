import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MockInterview } from "./mock-interview";

describe("MockInterview", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("starts question-first and records progressive reveals", () => {
    render(<MockInterview />);

    fireEvent.click(screen.getByRole("button", { name: /start 60-minute/i }));
    fireEvent.click(screen.getByRole("button", { name: /start coding/i }));

    expect(screen.getByText("Longest Unique Substring")).toBeVisible();
    expect(screen.queryByText(/sliding window with a hash map/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reveal Hint 1" }));

    expect(
      screen.getByText(/track the left boundary of a window/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reveal Reference solution" }),
    ).toBeDisabled();
  });

  it("requires complexity before revealing the solution", () => {
    render(
      <MockInterview externalControl={{ action: "start", strict: true }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start coding/i }));

    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Complexity analysis"), {
      target: { value: "Time O(n), space O(n)" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reveal Reference solution" }),
    );

    expect(
      screen.getByText(/export function longestUniqueSubstring/),
    ).toBeVisible();
  });

  it("recovers session state and produces an independent communication score", () => {
    localStorage.setItem(
      "interview-studio.mock-interview",
      JSON.stringify({
        activeSeconds: 120,
        checklist: ["Restate the problem"],
        code: "",
        complexity: "",
        notes: "",
        phase: "coding",
        questionIndex: 0,
        reveals: [],
        scratchpad: "",
        strict: false,
      }),
    );

    render(<MockInterview />);

    expect(screen.getByText("10%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(screen.getByText("Interview scorecard")).toBeVisible();
    expect(screen.getByText("10%")).toBeVisible();
  });

  it("resets through external control", () => {
    render(
      <MockInterview externalControl={{ action: "reset", strict: false }} />,
    );

    expect(
      screen.getByRole("button", { name: /start 60-minute session/i }),
    ).toBeVisible();
  });

  it("pauses, resumes, transitions phases, and records coding metrics", () => {
    vi.useFakeTimers();
    render(<MockInterview />);

    fireEvent.click(screen.getByRole("button", { name: /start 60-minute/i }));
    fireEvent.change(screen.getByLabelText("Concept answer notes"), {
      target: { value: "State and props trigger renders." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText("Session 60:00")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Session 59:59")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /start coding/i }));

    fireEvent.change(screen.getByLabelText("Test-case scratchpad"), {
      target: { value: "empty, duplicate, Unicode" },
    });
    fireEvent.change(screen.getByLabelText("Candidate solution"), {
      target: { value: "function solution() {}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark runnable" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark tests passing" }));
    fireEvent.click(screen.getByLabelText("Restate the problem"));
    fireEvent.click(screen.getByLabelText("Restate the problem"));
    fireEvent.click(screen.getByLabelText("Ask clarifying questions"));
    fireEvent.click(screen.getByRole("button", { name: "End session" }));

    expect(screen.getByText(/First runnable: 00:01/)).toBeVisible();
    expect(screen.getByText(/Practice: Restate the problem/)).toBeVisible();
  });

  it("reveals every aid after a complexity commitment", () => {
    render(<MockInterview />);
    fireEvent.click(screen.getByRole("button", { name: /start 60-minute/i }));
    fireEvent.click(screen.getByRole("button", { name: /start coding/i }));
    fireEvent.change(screen.getByLabelText("Complexity analysis"), {
      target: { value: "O(n) time and space" },
    });

    for (const name of [
      "Reveal Clarifying questions",
      "Reveal Hint 1",
      "Reveal Hint 2",
      "Reveal Pattern",
      "Reveal Approach",
      "Reveal Reference solution",
      "Reveal Reference tests",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }

    expect(
      screen.getByText(/confirm that a substring is contiguous/i),
    ).toBeVisible();
    expect(screen.getByText(/scan once with a right pointer/i)).toBeVisible();
    expect(screen.getByText(/expect\(longestUniqueSubstring/)).toBeVisible();
  });

  it("handles external end and starts a fresh session from the scorecard", () => {
    const { rerender } = render(
      <MockInterview externalControl={{ action: "start", strict: false }} />,
    );
    rerender(
      <MockInterview externalControl={{ action: "end", strict: false }} />,
    );

    expect(screen.getByText("Interview scorecard")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(
      screen.getByRole("button", { name: /start 60-minute session/i }),
    ).toBeVisible();
  });
});
