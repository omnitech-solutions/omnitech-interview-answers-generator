// The room kept for the call window: how tall it is, how the bar under it
// changes that (keys, a drag, a double click), and what is remembered.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallSlot } from "./call-slot";
import { COACH_LAYOUT_RESET } from "./coach-columns";

const KEY = "omnitech.interview.call-slot.height";
const WINDOW_HEIGHT = 768;
// The notes beneath always keep 160 px.
const CEILING = WINDOW_HEIGHT - 160;

const bar = () => screen.getByTestId("pn-call-slot-resize");
const height = () => Number(bar().getAttribute("aria-valuenow"));
const kept = () => window.localStorage.getItem(KEY);
const press = (key: string) => fireEvent.keyDown(bar(), { key });
// React reads clientY from a mouse event; jsdom's pointer events may not carry it.
const pointer = (type: "Down" | "Move" | "Up" | "Cancel", clientY = 0) => {
  const event = new MouseEvent(`pointer${type.toLowerCase()}`, {
    bubbles: true,
    cancelable: true,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(bar(), event);
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("innerHeight", WINDOW_HEIGHT);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-no-drag");
});

describe("the room for the call window", () => {
  it("opens 250 px tall, outlined, and lets clicks through to the call", () => {
    render(<CallSlot />);
    const slot = screen.getByRole("img", { name: "Room for the call window" });
    expect(slot).toHaveAttribute("data-testid", "pn-call-slot");
    expect(slot).toHaveStyle({ flex: "0 0 250px", pointerEvents: "none" });
    expect(slot.style.border).toContain("dashed");
    expect(slot).not.toHaveAttribute("data-hit-surface");
  });

  it("has a vertical slider under it that says its height and its bounds, and takes the mouse", () => {
    render(<CallSlot />);
    const slider = screen.getByRole("slider", {
      name: "Height of the room for the call window",
    });
    expect(slider).toBe(bar());
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", String(CEILING));
    expect(slider).toHaveAttribute("aria-valuenow", "250");
    expect(slider).toHaveAttribute("tabindex", "0");
    expect(slider).toHaveAttribute("data-hit-surface");
    expect(
      screen.getByTestId("pn-call-slot").compareDocumentPosition(slider) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the keys", () => {
  it("the arrows step 24 px and keep the height for the next session", () => {
    render(<CallSlot />);
    press("ArrowDown");
    expect(height()).toBe(274);
    expect(kept()).toBe("274");
    press("ArrowUp");
    press("ArrowUp");
    expect(height()).toBe(226);
    expect(kept()).toBe("226");
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 226px",
    });
  });

  it("Home folds the room away and End takes all but the notes' floor", () => {
    render(<CallSlot />);
    press("Home");
    expect(height()).toBe(0);
    expect(kept()).toBe("0");
    // Folded away, it draws no outline.
    expect(screen.getByTestId("pn-call-slot").style.border).not.toContain(
      "dashed",
    );
    press("End");
    expect(height()).toBe(CEILING);
    expect(kept()).toBe(String(CEILING));
  });

  it("never goes under nothing or over the ceiling", () => {
    render(<CallSlot />);
    press("Home");
    press("ArrowUp");
    expect(height()).toBe(0);
    press("End");
    press("ArrowDown");
    expect(height()).toBe(CEILING);
  });

  it("takes the keys it uses and leaves every other key alone", () => {
    render(<CallSlot />);
    expect(press("ArrowDown")).toBe(false);
    expect(press("Home")).toBe(false);
    const before = height();
    expect(press("Tab")).toBe(true);
    expect(press("a")).toBe(true);
    expect(height()).toBe(before);
  });
});

describe("dragging the bar", () => {
  it("follows the pointer from where the drag began, and keeps the height", () => {
    render(<CallSlot />);
    pointer("Down", 300);
    pointer("Move", 360);
    expect(height()).toBe(310);
    pointer("Move", 240);
    expect(height()).toBe(190);
    expect(kept()).toBe("190");
    pointer("Up", 240);
    expect(height()).toBe(190);
  });

  it("stops at nothing and at the ceiling", () => {
    render(<CallSlot />);
    pointer("Down", 300);
    pointer("Move", -900);
    expect(height()).toBe(0);
    pointer("Move", 5_000);
    expect(height()).toBe(CEILING);
  });

  it.each(["Up", "Cancel"] as const)(
    "a pointer that only passes over does nothing: before a press, and after pointer %s",
    (end) => {
      render(<CallSlot />);
      pointer("Move", 500);
      expect(height()).toBe(250);
      pointer("Down", 300);
      pointer("Move", 320);
      pointer(end, 320);
      pointer("Move", 600);
      expect(height()).toBe(270);
    },
  );

  it("captures the pointer, so the drag holds when it leaves the bar", () => {
    const capture = vi.spyOn(Element.prototype, "setPointerCapture");
    render(<CallSlot />);
    pointer("Down", 300);
    expect(capture).toHaveBeenCalledWith(1);
  });
});

describe("a double click", () => {
  it("folds the room away and brings back the height it had", () => {
    render(<CallSlot />);
    press("ArrowDown");
    fireEvent.doubleClick(bar());
    expect(height()).toBe(0);
    expect(kept()).toBe("0");
    fireEvent.doubleClick(bar());
    expect(height()).toBe(274);
    expect(kept()).toBe("274");
  });

  it("brings back the last height above nothing, however it was folded", () => {
    render(<CallSlot />);
    pointer("Down", 300);
    pointer("Move", 400);
    pointer("Move", -900);
    pointer("Up", -900);
    expect(height()).toBe(0);
    fireEvent.doubleClick(bar());
    expect(height()).toBe(350);
  });
});

describe("the remembered height", () => {
  it("is the one kept from an earlier session", () => {
    window.localStorage.setItem(KEY, "320");
    render(<CallSlot />);
    expect(height()).toBe(320);
  });

  it("a room folded away stays folded, and a double click opens it at 250", () => {
    window.localStorage.setItem(KEY, "0");
    render(<CallSlot />);
    expect(height()).toBe(0);
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({ flex: "0 0 0px" });
    fireEvent.doubleClick(bar());
    expect(height()).toBe(250);
  });

  it("is shown no taller than this window allows", () => {
    window.localStorage.setItem(KEY, "5000");
    render(<CallSlot />);
    expect(height()).toBe(CEILING);
  });

  it.each([
    ["a word", "tall"],
    ["a negative height", "-40"],
    ["no number at all", "NaN"],
  ])("is 250 for %s", (_name, value) => {
    window.localStorage.setItem(KEY, value);
    render(<CallSlot />);
    expect(height()).toBe(250);
  });

  it("is 250 when storage cannot be read, and still resizes when it cannot be written", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const blocked = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    render(<CallSlot />);
    expect(height()).toBe(250);
    press("ArrowDown");
    expect(blocked).toHaveBeenCalled();
    expect(height()).toBe(274);
  });
});

describe("holding the window still", () => {
  const held = () => document.documentElement.hasAttribute("data-no-drag");

  it.each(["Up", "Cancel"] as const)(
    "the page tells the shell not to move the window while the bar is held, until pointer %s",
    (end) => {
      render(<CallSlot />);
      expect(held()).toBe(false);
      pointer("Down", 300);
      expect(held()).toBe(true);
      pointer("Move", 360);
      expect(held()).toBe(true);
      pointer(end, 360);
      expect(held()).toBe(false);
    },
  );

  it("the keys and a double click never hold it", () => {
    render(<CallSlot />);
    press("ArrowDown");
    fireEvent.doubleClick(bar());
    expect(held()).toBe(false);
  });
});

describe("Reset layout", () => {
  const reset = () =>
    act(() => {
      window.dispatchEvent(new Event(COACH_LAYOUT_RESET));
    });

  it("puts the room back to 250 px and keeps that", () => {
    window.localStorage.setItem(KEY, "410");
    render(<CallSlot />);
    expect(height()).toBe(410);
    reset();
    expect(height()).toBe(250);
    expect(kept()).toBe("250");
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 250px",
    });
  });

  it("opens a room that was folded away, and a double click then folds and brings back 250", () => {
    render(<CallSlot />);
    press("End");
    press("Home");
    expect(height()).toBe(0);
    reset();
    expect(height()).toBe(250);
    fireEvent.doubleClick(bar());
    expect(height()).toBe(0);
    fireEvent.doubleClick(bar());
    expect(height()).toBe(250);
  });

  it("is no taller than a short window allows", () => {
    vi.stubGlobal("innerHeight", 300);
    render(<CallSlot />);
    reset();
    expect(height()).toBe(140);
  });

  it("is not heard once the room has gone", () => {
    window.localStorage.setItem(KEY, "410");
    const drawn = render(<CallSlot />);
    drawn.unmount();
    window.dispatchEvent(new Event(COACH_LAYOUT_RESET));
    expect(kept()).toBe("410");
  });
});
