// The shared strip and its dismissal: what each action reports, what cannot
// run says why, and "Looks complete" is kept per session, task and revision.
import type { LiveMissingContext } from "@omnitech/interview-contracts";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_CONTEXT_ACTIONS,
  MissingContextStrip,
} from "./missing-context-strip";
import { dismissalKey, useMissingContext } from "./use-missing-context";

const ITEMS: LiveMissingContext = [
  { kind: "constraints", note: "the limits are cut off" },
  { kind: "other" },
];

describe("MissingContextStrip", () => {
  it.each(["native", "web"] as const)(
    "%s: lists what is missing and reports each action by id",
    (variant) => {
      const onAction = vi.fn();
      render(
        <MissingContextStrip
          items={ITEMS}
          variant={variant}
          onAction={onAction}
        />,
      );
      const strip = screen.getByTestId("missing-context");
      expect(strip).toHaveAttribute("role", "note");
      expect(strip).toHaveTextContent("Constraints: the limits are cut off");
      expect(strip).toHaveTextContent("Something else");
      for (const action of MISSING_CONTEXT_ACTIONS) {
        fireEvent.click(screen.getByRole("button", { name: action.label }));
        expect(onAction).toHaveBeenLastCalledWith(action.id);
      }
      expect(onAction).toHaveBeenCalledTimes(3);
    },
  );

  it("keeps an unavailable action visible, disabled, with its reason", () => {
    const onAction = vi.fn();
    render(
      <MissingContextStrip
        items={ITEMS}
        variant="web"
        onAction={onAction}
        unavailable={{ screenshot: "Not while the session is paused." }}
      />,
    );
    const add = screen.getByRole("button", { name: "Add another screenshot" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(onAction).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("missing-screenshot-unavailable"),
    ).toHaveTextContent("Not while the session is paused.");
    expect(screen.getByRole("button", { name: "Add context" })).toBeEnabled();
  });
});

describe("useMissingContext", () => {
  const card = (
    revision: number,
    missingContext: LiveMissingContext | null,
  ) => ({
    taskId: "task-1",
    revision,
    missingContext,
  });
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("shows the list until the person says it looks complete, for that revision only", () => {
    const { result, rerender } = renderHook(
      ({ revision }) => useMissingContext("s-1", card(revision, ITEMS)),
      { initialProps: { revision: 1 } },
    );
    expect(result.current.missing).toEqual(ITEMS);
    act(() => result.current.dismiss());
    expect(result.current.missing).toBeNull();
    // A newer revision that reports missing context again asks again.
    rerender({ revision: 2 });
    expect(result.current.missing).toEqual(ITEMS);
  });

  it("remembers the dismissal across a reload and keeps it to its own session", () => {
    const first = renderHook(() => useMissingContext("s-1", card(1, ITEMS)));
    act(() => first.result.current.dismiss());
    first.unmount();
    expect(
      renderHook(() => useMissingContext("s-1", card(1, ITEMS))).result.current
        .missing,
    ).toBeNull();
    expect(
      renderHook(() => useMissingContext("s-2", card(1, ITEMS))).result.current
        .missing,
    ).toEqual(ITEMS);
  });

  it("has nothing to show without a list, and keeps only task and revision in storage", () => {
    const { result } = renderHook(() =>
      useMissingContext("s-1", card(1, null)),
    );
    expect(result.current.missing).toBeNull();
    act(() => result.current.dismiss());
    expect(
      window.localStorage.getItem(
        "interview-studio.live.missing-dismissed.s-1",
      ),
    ).toBe(JSON.stringify([dismissalKey("task-1", 1)]));
  });

  it("works for this page when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() =>
      useMissingContext("s-1", card(1, ITEMS)),
    );
    expect(result.current.missing).toEqual(ITEMS);
    act(() => result.current.dismiss());
    expect(result.current.missing).toBeNull();
  });

  it("ignores a damaged stored value", () => {
    window.localStorage.setItem(
      "interview-studio.live.missing-dismissed.s-1",
      "{not json",
    );
    const { result } = renderHook(() =>
      useMissingContext("s-1", card(1, ITEMS)),
    );
    expect(result.current.missing).toEqual(ITEMS);
  });
});
