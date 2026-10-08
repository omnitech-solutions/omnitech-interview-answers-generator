// How the transcript pane is laid out: the choice, where it is kept, and who is
// told. The suite's setup replaces useChatView with a test-controlled value, so
// this file reads the real module, fresh for each test (it remembers the
// choice in a module variable).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pref = typeof import("./chat-view-pref");
const KEY = "omnitech.interview.chat.view";
const load = async (): Promise<Pref> => {
  vi.resetModules();
  return vi.importActual<Pref>("./chat-view-pref");
};

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("the views on offer", () => {
  it("are the two conversation layouts and the transcript, each with a label and a hint", async () => {
    const { CHAT_VIEWS } = await load();
    expect(CHAT_VIEWS.map((view) => view.id)).toEqual([
      "conversation-slot",
      "conversation",
      "transcript",
    ]);
    for (const view of CHAT_VIEWS) {
      expect(view.label).not.toBe("");
      expect(view.hint).not.toBe("");
    }
  });

  it("only the transcript keeps the coach panel apart; only one layout leaves room for the call", async () => {
    const { isConversation, hasCallSlot } = await load();
    expect(isConversation("transcript")).toBe(false);
    expect(isConversation("conversation")).toBe(true);
    expect(isConversation("conversation-slot")).toBe(true);
    expect(hasCallSlot("transcript")).toBe(false);
    expect(hasCallSlot("conversation")).toBe(false);
    expect(hasCallSlot("conversation-slot")).toBe(true);
  });
});

describe("the chosen view", () => {
  it("is the transcript until one is chosen", async () => {
    const { useChatView } = await load();
    expect(renderHook(() => useChatView()).result.current).toBe("transcript");
  });

  it("is the one remembered from an earlier session", async () => {
    window.localStorage.setItem(KEY, "conversation-slot");
    const { useChatView } = await load();
    expect(renderHook(() => useChatView()).result.current).toBe(
      "conversation-slot",
    );
  });

  it.each([
    ["a view that no longer exists", "split"],
    ["an empty value", ""],
    ["another key's kind of value", "true"],
  ])("falls back to the transcript for %s", async (_name, kept) => {
    window.localStorage.setItem(KEY, kept);
    const { useChatView } = await load();
    expect(renderHook(() => useChatView()).result.current).toBe("transcript");
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

  it("tells every reader at once: the pane and the coach panel change together", async () => {
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
    act(() => setChatView("conversation-slot"));
    expect(blocked).toHaveBeenCalled();
    expect(reader.result.current).toBe("conversation-slot");
  });

  it("is the transcript when storage cannot be read", async () => {
    window.localStorage.setItem(KEY, "conversation");
    const { useChatView } = await load();
    const blocked = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(renderHook(() => useChatView()).result.current).toBe("transcript");
    expect(blocked).toHaveBeenCalled();
  });
});
