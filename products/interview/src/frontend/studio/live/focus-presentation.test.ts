import { afterEach, describe, expect, it } from "vitest";
import { presentation } from "./focus-presentation";

afterEach(() => {
  presentation.reset();
  window.sessionStorage.clear();
});

describe("the live page is always the full Studio view", () => {
  it("never remembers the card, maximized or float across visits", () => {
    window.sessionStorage.setItem("interview-studio.live.presentation", "card");
    presentation.reset();
    expect(presentation.get().mode).toBe("full");
    presentation.setMode("card");
    expect(presentation.get().mode).toBe("card");
    // Nothing is written for the next visit.
    window.sessionStorage.clear();
    presentation.setMode("floating");
    expect(
      window.sessionStorage.getItem("interview-studio.live.presentation"),
    ).toBeNull();
    presentation.setMode("maximized");
    presentation.reset();
    expect(presentation.get().mode).toBe("full");
  });
});
