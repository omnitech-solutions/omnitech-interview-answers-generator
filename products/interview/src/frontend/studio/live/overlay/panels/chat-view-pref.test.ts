// How the live window is laid out (the View menu): the choice, where it is kept, and who is
// told. The suite's setup replaces useChatView with a test-controlled value, so
// this file reads the real module, fresh for each test (it remembers the
// choice in a module variable).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pref = typeof import("./chat-view-pref");
const KEY = "omnitech.interview.view";
const load = async (): Promise<Pref> => {
  vi.resetModules();
  return vi.importActual<Pref>("./chat-view-pref");
};

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("the views on offer", () => {
  it("are the three coach layouts, then the original and the transcript, each with a label and a hint", async () => {
    const { CHAT_VIEWS } = await load();
    expect(CHAT_VIEWS.map((view) => [view.id, view.group])).toEqual([
      ["coach", "coach"],
      ["conversation", "coach"],
      ["prompter", "coach"],
      ["original", "classic"],
      ["transcript", "classic"],
    ]);
    for (const view of CHAT_VIEWS) {
      expect(view.label).not.toBe("");
      expect(view.hint).not.toBe("");
    }
    expect(new Set(CHAT_VIEWS.map((view) => view.label)).size).toBe(
      CHAT_VIEWS.length,
    );
  });

  it("come in two named groups, and every view belongs to one of them", async () => {
    const { CHAT_VIEWS, VIEW_GROUPS } = await load();
    expect(VIEW_GROUPS).toEqual([
      { id: "coach", label: "Coach" },
      { id: "classic", label: "Classic" },
    ]);
    const groups: readonly string[] = VIEW_GROUPS.map((group) => group.id);
    for (const view of CHAT_VIEWS) expect(groups).toContain(view.group);
  });

  it("only the coach layouts draw the notes themselves", async () => {
    const { CHAT_VIEWS, isCoachView } = await load();
    for (const view of CHAT_VIEWS)
      expect(isCoachView(view.id)).toBe(view.group === "coach");
  });

  it("each coach layout says what it asks of the window: three columns for two of them, one for the prompter", async () => {
    const { COACH_WINDOW, QUESTIONS_WIDTH, RIGHT_WIDTH, CHAT_VIEWS } =
      await load();
    expect(Object.keys(COACH_WINDOW).sort()).toEqual(
      CHAT_VIEWS.filter((view) => view.group === "coach")
        .map((view) => view.id)
        .sort(),
    );
    // The centre column is never under 560.
    for (const id of ["coach", "conversation"] as const)
      expect(COACH_WINDOW[id].width).toBeGreaterThanOrEqual(
        QUESTIONS_WIDTH + 560 + RIGHT_WIDTH,
      );
    expect(COACH_WINDOW.prompter.width).toBeLessThan(COACH_WINDOW.coach.width);
    for (const size of Object.values(COACH_WINDOW))
      expect(size.height).toBeGreaterThan(0);
  });
});

describe("the chosen view", () => {
  it("is the original until one is chosen", async () => {
    const { useChatView } = await load();
    expect(renderHook(() => useChatView()).result.current).toBe("original");
  });

  it("is the one remembered from an earlier session", async () => {
    window.localStorage.setItem(KEY, "prompter");
    const { useChatView } = await load();
    expect(renderHook(() => useChatView()).result.current).toBe("prompter");
  });

  it.each([
    ["a view that no longer exists", "conversation-slot"],
    ["an empty value", ""],
    ["another key's kind of value", "true"],
  ])("falls back to the original for %s", async (_name, kept) => {
    window.localStorage.setItem(KEY, kept);
    const { useChatView } = await load();
    expect(renderHook(() => useChatView()).result.current).toBe("original");
  });

  it("is kept for the next session when chosen", async () => {
    const { setChatView } = await load();
    setChatView("conversation");
    expect(window.localStorage.getItem(KEY)).toBe("conversation");
    const again = await load();
    expect(renderHook(() => again.useChatView()).result.current).toBe(
      "conversation",
    );
  });

  it("tells every reader at once: the window and the coach panel change together", async () => {
    const { setChatView, useChatView } = await load();
    const pane = renderHook(() => useChatView());
    const coach = renderHook(() => useChatView());
    act(() => setChatView("conversation"));
    expect(pane.result.current).toBe("conversation");
    expect(coach.result.current).toBe("conversation");
    act(() => setChatView("transcript"));
    expect(pane.result.current).toBe("transcript");
    expect(coach.result.current).toBe("transcript");
  });

  it("stops telling a reader that has gone", async () => {
    const { setChatView, useChatView } = await load();
    let draws = 0;
    const reader = renderHook(() => {
      draws += 1;
      return useChatView();
    });
    reader.unmount();
    const before = draws;
    act(() => setChatView("conversation"));
    expect(draws).toBe(before);
  });

  it("still holds for this window when storage is blocked", async () => {
    const { setChatView, useChatView } = await load();
    const reader = renderHook(() => useChatView());
    const blocked = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    act(() => setChatView("prompter"));
    expect(blocked).toHaveBeenCalled();
    expect(reader.result.current).toBe("prompter");
  });

  it("is the original when storage cannot be read", async () => {
    window.localStorage.setItem(KEY, "conversation");
    const { useChatView } = await load();
    const blocked = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(renderHook(() => useChatView()).result.current).toBe("original");
    expect(blocked).toHaveBeenCalled();
  });
});

describe("an older choice", () => {
  it("kept under the retired key is not read: the window opens in the original", async () => {
    window.localStorage.setItem("omnitech.interview.chat.view", "conversation");
    const { useChatView } = await load();
    expect(renderHook(() => useChatView()).result.current).toBe("original");
  });
});
