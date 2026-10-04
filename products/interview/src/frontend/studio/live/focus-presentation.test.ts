// Presentation modes and the memory of the one before the float.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardInTab, cardSize, presentation } from "./focus-presentation";

beforeEach(() => presentation.reset());
afterEach(() => presentation.reset());

describe("presentation modes", () => {
  it("starts on the dashboard", () => {
    expect(presentation.get()).toMatchObject({
      mode: "full",
      float: "closed",
      pinnedTaskId: null,
    });
  });

  it.each([
    ["full", "full"],
    ["card", "card"],
    ["maximized", "maximized"],
  ] as const)(
    "closing the float returns to %s, the mode it was opened from",
    (from, back) => {
      presentation.setMode(from);
      presentation.setMode("floating");
      expect(presentation.get().mode).toBe("floating");
      presentation.setFloat("pip");
      presentation.closeFloat();
      expect(presentation.get()).toMatchObject({ mode: back, float: "closed" });
    },
  );

  it("forgets the memory once a tab mode is chosen again", () => {
    presentation.setMode("card");
    presentation.setMode("floating");
    presentation.setMode("full");
    presentation.setMode("floating");
    presentation.closeFloat();
    expect(presentation.get().mode).toBe("full");
  });

  it("closing the card in the tab returns to the dashboard", () => {
    presentation.setMode("maximized");
    presentation.closeFloat();
    expect(presentation.get().mode).toBe("full");
  });

  it("keeps the pinned task when the float closes", () => {
    presentation.setMode("card");
    presentation.pin("task-1");
    presentation.setMode("floating");
    presentation.closeFloat();
    expect(presentation.get()).toMatchObject({
      mode: "card",
      pinnedTaskId: "task-1",
    });
  });

  it("names the card's size and whether the tab shows it", () => {
    presentation.setMode("card");
    expect(cardInTab(presentation.get())).toBe(true);
    expect(cardSize(presentation.get())).toBe("compact");
    presentation.setMode("maximized");
    expect(cardSize(presentation.get())).toBe("maximized");
    presentation.setMode("floating");
    expect(cardInTab(presentation.get())).toBe(false);
    presentation.setFloat("fallback");
    expect(cardInTab(presentation.get())).toBe(true);
  });

  it("remembers the in-tab mode in sessionStorage, and survives it throwing", () => {
    presentation.setMode("maximized");
    expect(
      window.sessionStorage.getItem("interview-studio.live.presentation"),
    ).toBe("maximized");
    presentation.setMode("floating");
    // The float is not remembered: a reload comes back to the tab mode.
    expect(
      window.sessionStorage.getItem("interview-studio.live.presentation"),
    ).toBe("maximized");
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => presentation.setMode("card")).not.toThrow();
    spy.mockRestore();
  });
});
