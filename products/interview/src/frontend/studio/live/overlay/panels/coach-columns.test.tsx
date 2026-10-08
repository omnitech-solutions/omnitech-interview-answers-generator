// The sizes a coach layout keeps: the two side columns (their bounds, the bar
// between a column and the centre, what is remembered), the reset that puts
// everything back, and the window's own width with the bars at its edges.
// The module remembers the window's width in a variable, so each test reads
// it fresh.
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Columns = typeof import("./coach-columns");
type Side = "left" | "right";
const KEY = "omnitech.interview.coach.columns";
const WINDOW_KEY = "omnitech.interview.coach.window-width";
// A row wide enough that neither column is held back by the other.
const ROW = 1_200;
const SCREEN = 1_600;
const WINDOW = 1_000;

const load = async (): Promise<Columns> => {
  vi.resetModules();
  return import("./coach-columns");
};
// jsdom lays nothing out: the row is as wide as the test says.
const rowIs = (width: number) =>
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);

// The two bars over one row, as the layout draws them.
async function mount(row = ROW) {
  rowIs(row);
  const columns = await load();
  function Row() {
    const sizes = columns.useCoachColumns();
    return (
      <div ref={sizes.row}>
        {(["left", "right"] as const).map((side) => (
          <columns.ColumnSplitter
            key={side}
            side={side}
            width={sizes.columns[side]}
            max={sizes.ceiling(side)}
            onResize={(width) => sizes.resize(side, width)}
            onReset={() => sizes.resetSide(side)}
          />
        ))}
        <button type="button" onClick={sizes.reset}>
          Reset
        </button>
      </div>
    );
  }
  const drawn = render(<Row />);
  // The row is only known once it is drawn: the bounds are right from the
  // next draw on.
  drawn.rerender(<Row />);
  return columns;
}

const bar = (side: Side) => screen.getByTestId(`pn-coach-splitter-${side}`);
const width = (side: Side) => Number(bar(side).getAttribute("aria-valuenow"));
const most = (side: Side) => Number(bar(side).getAttribute("aria-valuemax"));
const widths = () => [width("left"), width("right")];
const kept = () => JSON.parse(window.localStorage.getItem(KEY) ?? "null");
const press = (side: Side, key: string) =>
  fireEvent.keyDown(bar(side), { key });
// React reads clientX and screenX from a mouse event; jsdom's pointer events
// may not carry them.
const pointer = (
  element: Element,
  type: "Down" | "Move" | "Up" | "Cancel",
  x = 0,
) => {
  const event = new MouseEvent(`pointer${type.toLowerCase()}`, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    screenX: x,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(element, event);
};
const held = () => document.documentElement.hasAttribute("data-no-drag");

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("innerWidth", WINDOW);
  vi.stubGlobal("screen", { availWidth: SCREEN });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-no-drag");
});

describe("the side columns", () => {
  it("open 250 and 400 px wide, and nothing is written until one is resized", async () => {
    await mount();
    expect(widths()).toEqual([250, 400]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("each has a horizontal slider that says its width and its bounds, and takes the mouse", async () => {
    await mount();
    const left = screen.getByRole("slider", {
      name: "Width of the questions column",
    });
    const right = screen.getByRole("slider", {
      name: "Width of the right column",
    });
    expect(left).toBe(bar("left"));
    expect(right).toBe(bar("right"));
    for (const slider of [left, right]) {
      expect(slider).toHaveAttribute("aria-orientation", "horizontal");
      expect(slider).toHaveAttribute("aria-valuemin", "0");
      expect(slider).toHaveAttribute("tabindex", "0");
      expect(slider).toHaveAttribute("data-hit-surface");
      expect(slider).toHaveAttribute(
        "title",
        "Drag to resize. Double-click to put this column back.",
      );
    }
  });

  it("before the row is drawn there is no bound to give: the slider's most is its own width", async () => {
    rowIs(ROW);
    const { ColumnSplitter, useCoachColumns } = await load();
    const { result } = renderHook(() => useCoachColumns());
    expect(result.current.ceiling("right")).toBe(Number.POSITIVE_INFINITY);
    render(
      <ColumnSplitter
        side="right"
        width={400}
        max={result.current.ceiling("right")}
        onResize={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(most("right")).toBe(400);
  });
});

describe("how wide a column may be", () => {
  it("the right column takes what the questions, the centre's 320 px and the four bars leave", async () => {
    await mount();
    // 1200 - 250 (questions) - 320 (centre) - 4 x 8 (bars).
    expect(most("right")).toBe(598);
    press("right", "End");
    expect(width("right")).toBe(598);
    // The centre is still there: a wider right column leaves the questions less.
    expect(most("left")).toBe(1_200 - 598 - 320 - 32);
  });

  it("the questions column is never widened past 360 px, however much room there is", async () => {
    await mount(2_400);
    expect(most("left")).toBe(360);
    press("left", "End");
    expect(width("left")).toBe(360);
    press("left", "ArrowRight");
    expect(width("left")).toBe(360);
  });

  it("in a narrow row the questions column stops where the centre's floor begins", async () => {
    await mount(900);
    // 900 - 400 (right) - 320 - 32.
    expect(most("left")).toBe(148);
    press("left", "End");
    expect(width("left")).toBe(148);
    press("left", "ArrowRight");
    expect(width("left")).toBe(148);
  });

  it("a row with no room to spare gives a column none: a resize folds it away", async () => {
    await mount(500);
    expect(most("left")).toBe(0);
    expect(most("right")).toBe(0);
    press("right", "ArrowLeft");
    expect(width("right")).toBe(0);
  });

  it("never goes under nothing", async () => {
    await mount();
    press("left", "Home");
    press("left", "ArrowLeft");
    expect(width("left")).toBe(0);
    press("right", "Home");
    press("right", "ArrowRight");
    expect(width("right")).toBe(0);
    expect(kept()).toEqual({ left: 0, right: 0 });
  });

  it("is kept in whole pixels", async () => {
    const { useCoachColumns } = await mount();
    const { result } = renderHook(() => useCoachColumns());
    act(() => result.current.resize("right", 310.6));
    expect(result.current.columns.right).toBe(311);
    expect(kept().right).toBe(311);
  });
});

describe("the keys", () => {
  it("on the left bar, right widens the questions and left narrows them, 24 px a press", async () => {
    await mount();
    press("left", "ArrowRight");
    expect(widths()).toEqual([274, 400]);
    press("left", "ArrowLeft");
    press("left", "ArrowLeft");
    expect(widths()).toEqual([226, 400]);
    expect(kept()).toEqual({ left: 226, right: 400 });
  });

  it("on the right bar they are mirrored: the bar moves the way the arrow points", async () => {
    await mount();
    press("right", "ArrowLeft");
    expect(widths()).toEqual([250, 424]);
    press("right", "ArrowRight");
    press("right", "ArrowRight");
    expect(widths()).toEqual([250, 376]);
    expect(kept()).toEqual({ left: 250, right: 376 });
  });

  it.each(["left", "right"] as const)(
    "Home folds the %s column away and End makes it as wide as it may be",
    async (side) => {
      await mount();
      const ceiling = most(side);
      press(side, "Home");
      expect(width(side)).toBe(0);
      expect(kept()[side]).toBe(0);
      press(side, "End");
      // With the other column at its own width, the bound is the one drawn.
      expect(width(side)).toBe(ceiling);
      expect(kept()[side]).toBe(ceiling);
    },
  );

  it("takes the keys it uses and leaves every other key alone", async () => {
    await mount();
    expect(press("left", "ArrowRight")).toBe(false);
    expect(press("left", "Home")).toBe(false);
    const before = widths();
    expect(press("left", "Tab")).toBe(true);
    expect(press("left", "ArrowDown")).toBe(true);
    expect(press("right", "a")).toBe(true);
    expect(widths()).toEqual(before);
  });
});

describe("dragging a bar", () => {
  it("the left bar: the questions follow the pointer from where the drag began", async () => {
    await mount();
    pointer(bar("left"), "Down", 300);
    pointer(bar("left"), "Move", 340);
    expect(widths()).toEqual([290, 400]);
    pointer(bar("left"), "Move", 220);
    expect(widths()).toEqual([170, 400]);
    expect(kept()).toEqual({ left: 170, right: 400 });
    pointer(bar("left"), "Up", 220);
    expect(widths()).toEqual([170, 400]);
  });

  it("the right bar: dragging right narrows the right column, dragging left widens it", async () => {
    await mount();
    pointer(bar("right"), "Down", 800);
    pointer(bar("right"), "Move", 840);
    expect(widths()).toEqual([250, 360]);
    pointer(bar("right"), "Move", 700);
    expect(widths()).toEqual([250, 500]);
    expect(kept()).toEqual({ left: 250, right: 500 });
  });

  it("stops at nothing and at the column's bound", async () => {
    await mount();
    pointer(bar("left"), "Down", 300);
    pointer(bar("left"), "Move", -900);
    expect(width("left")).toBe(0);
    pointer(bar("left"), "Move", 5_000);
    expect(width("left")).toBe(360);
    pointer(bar("left"), "Up", 5_000);
    pointer(bar("right"), "Down", 800);
    pointer(bar("right"), "Move", -5_000);
    expect(width("right")).toBe(1_200 - 360 - 320 - 32);
    pointer(bar("right"), "Move", 5_000);
    expect(width("right")).toBe(0);
  });

  it.each(["Up", "Cancel"] as const)(
    "a pointer that only passes over does nothing: before a press, and after pointer %s",
    async (end) => {
      await mount();
      pointer(bar("left"), "Move", 500);
      expect(width("left")).toBe(250);
      pointer(bar("left"), "Down", 300);
      pointer(bar("left"), "Move", 320);
      pointer(bar("left"), end, 320);
      pointer(bar("left"), "Move", 600);
      expect(width("left")).toBe(270);
    },
  );

  it("captures the pointer, so the drag holds when it leaves the bar", async () => {
    const capture = vi.spyOn(Element.prototype, "setPointerCapture");
    await mount();
    pointer(bar("right"), "Down", 800);
    expect(capture).toHaveBeenCalledWith(1);
  });

  it.each([
    ["left", "Up"],
    ["left", "Cancel"],
    ["right", "Up"],
    ["right", "Cancel"],
  ] as const)(
    "the %s bar tells the shell not to move the window while it is held, until pointer %s",
    async (side, end) => {
      await mount();
      expect(held()).toBe(false);
      pointer(bar(side), "Down", 300);
      expect(held()).toBe(true);
      pointer(bar(side), "Move", 340);
      expect(held()).toBe(true);
      pointer(bar(side), end, 340);
      expect(held()).toBe(false);
    },
  );
});

describe("a double click on a bar", () => {
  it.each([
    ["left", [250, 520]],
    ["right", [180, 400]],
  ] as const)(
    "puts the %s column back and leaves the other where it is",
    async (side, after) => {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ left: 180, right: 520 }),
      );
      await mount(2_400);
      expect(widths()).toEqual([180, 520]);
      fireEvent.doubleClick(bar(side));
      expect(widths()).toEqual(after);
      expect(kept()).toEqual({ left: after[0], right: after[1] });
    },
  );
});

describe("the remembered widths", () => {
  it("are the ones kept from an earlier session", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ left: 180, right: 520 }));
    await mount();
    expect(widths()).toEqual([180, 520]);
  });

  it("a column folded away stays folded", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ left: 0, right: 0 }));
    await mount();
    expect(widths()).toEqual([0, 0]);
  });

  it("a questions column kept wider than 360 px opens at 360; the right column is not capped that way", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ left: 900, right: 900 }));
    await mount();
    expect(widths()).toEqual([360, 900]);
  });

  it.each([
    ["not JSON", "{ wide"],
    ["a word", '"wide"'],
    ["a number", "300"],
    ["null", "null"],
    ["an empty object", "{}"],
    ["a list", "[300, 500]"],
  ])("are 250 and 400 when what was kept is %s", async (_name, value) => {
    window.localStorage.setItem(KEY, value);
    await mount();
    expect(widths()).toEqual([250, 400]);
  });

  it.each([
    ["a negative width", { left: -40, right: 520 }, [250, 520]],
    ["a word for a width", { left: 180, right: "wide" }, [180, 400]],
    ["a number written as text", { left: "180", right: 520 }, [250, 520]],
    ["only one side", { right: 520 }, [250, 520]],
    ["no number at all", { left: null, right: 520 }, [250, 520]],
  ])(
    "one bad side (%s) opens at its own width and the other is kept",
    async (_name, value, expected) => {
      window.localStorage.setItem(KEY, JSON.stringify(value));
      await mount();
      expect(widths()).toEqual(expected);
    },
  );

  it("are 250 and 400 when storage cannot be read, and still resize when it cannot be written", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const blocked = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    await mount();
    expect(widths()).toEqual([250, 400]);
    press("left", "ArrowRight");
    expect(blocked).toHaveBeenCalled();
    expect(widths()).toEqual([274, 400]);
  });
});

describe("Reset layout", () => {
  it("puts both columns back, keeps that, and tells everything else that keeps a size", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ left: 180, right: 520 }));
    const { COACH_LAYOUT_RESET } = await mount();
    const told = vi.fn();
    window.addEventListener(COACH_LAYOUT_RESET, told);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(widths()).toEqual([250, 400]);
      expect(kept()).toEqual({ left: 250, right: 400 });
      expect(told).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(COACH_LAYOUT_RESET, told);
    }
  });

  it("gives the window back the layout's own width", async () => {
    const { setCoachWindowWidth, useCoachWindowWidth } = await mount();
    const dragged = renderHook(() => useCoachWindowWidth());
    act(() => setCoachWindowWidth(1_500));
    expect(dragged.result.current).toBe(1_500);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(dragged.result.current).toBeNull();
    expect(window.localStorage.getItem(WINDOW_KEY)).toBeNull();
  });

  it("the event is named for the page, so nothing else answers it", async () => {
    const { COACH_LAYOUT_RESET } = await load();
    expect(COACH_LAYOUT_RESET).toBe("omnitech:coach-layout-reset");
  });
});

describe("useLayoutReset", () => {
  it("runs on every reset, with the newest thing it was given to do", async () => {
    const { COACH_LAYOUT_RESET, useLayoutReset } = await load();
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ run }) => useLayoutReset(run), {
      initialProps: { run: first },
    });
    act(() => {
      window.dispatchEvent(new Event(COACH_LAYOUT_RESET));
    });
    expect(first).toHaveBeenCalledTimes(1);
    hook.rerender({ run: second });
    act(() => {
      window.dispatchEvent(new Event(COACH_LAYOUT_RESET));
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops listening once its owner has gone, and is not run by any other event", async () => {
    const { COACH_LAYOUT_RESET, useLayoutReset } = await load();
    const run = vi.fn();
    const hook = renderHook(() => useLayoutReset(run));
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(run).not.toHaveBeenCalled();
    hook.unmount();
    window.dispatchEvent(new Event(COACH_LAYOUT_RESET));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("holding the window still", () => {
  it("marks the whole page while held and unmarks it after", async () => {
    const { holdWindowDrag } = await load();
    holdWindowDrag(true);
    expect(document.documentElement).toHaveAttribute("data-no-drag", "");
    holdWindowDrag(true);
    expect(held()).toBe(true);
    holdWindowDrag(false);
    expect(held()).toBe(false);
    holdWindowDrag(false);
    expect(held()).toBe(false);
  });
});

describe("the window's own width", () => {
  it("is the layout's own (none kept) until an edge is dragged", async () => {
    const { useCoachWindowWidth } = await load();
    expect(renderHook(() => useCoachWindowWidth()).result.current).toBeNull();
  });

  it("is kept for the next session, in whole pixels", async () => {
    const { setCoachWindowWidth } = await load();
    setCoachWindowWidth(1_234.6);
    expect(window.localStorage.getItem(WINDOW_KEY)).toBe("1235");
    const again = await load();
    expect(renderHook(() => again.useCoachWindowWidth()).result.current).toBe(
      1_235,
    );
  });

  it("is never under 480 px nor wider than the screen", async () => {
    const { setCoachWindowWidth, useCoachWindowWidth } = await load();
    const reader = renderHook(() => useCoachWindowWidth());
    act(() => setCoachWindowWidth(100));
    expect(reader.result.current).toBe(480);
    expect(window.localStorage.getItem(WINDOW_KEY)).toBe("480");
    act(() => setCoachWindowWidth(5_000));
    expect(reader.result.current).toBe(SCREEN);
    expect(window.localStorage.getItem(WINDOW_KEY)).toBe(String(SCREEN));
  });

  it("has no upper bound where the screen's width is not known", async () => {
    vi.stubGlobal("screen", { availWidth: 0 });
    const { setCoachWindowWidth, useCoachWindowWidth } = await load();
    const reader = renderHook(() => useCoachWindowWidth());
    act(() => setCoachWindowWidth(5_000));
    expect(reader.result.current).toBe(5_000);
  });

  it("null gives the layout its own width back and forgets what was kept", async () => {
    const { setCoachWindowWidth, useCoachWindowWidth } = await load();
    const reader = renderHook(() => useCoachWindowWidth());
    act(() => setCoachWindowWidth(1_500));
    act(() => setCoachWindowWidth(null));
    expect(reader.result.current).toBeNull();
    expect(window.localStorage.getItem(WINDOW_KEY)).toBeNull();
  });

  it("tells every reader at once, and stops telling one that has gone", async () => {
    const { setCoachWindowWidth, useCoachWindowWidth } = await load();
    const one = renderHook(() => useCoachWindowWidth());
    let draws = 0;
    const two = renderHook(() => {
      draws += 1;
      return useCoachWindowWidth();
    });
    act(() => setCoachWindowWidth(1_500));
    expect(one.result.current).toBe(1_500);
    expect(two.result.current).toBe(1_500);
    two.unmount();
    const before = draws;
    act(() => setCoachWindowWidth(1_400));
    expect(one.result.current).toBe(1_400);
    expect(draws).toBe(before);
  });

  it.each([
    ["a word", "wide"],
    ["a width under the floor", "200"],
    ["nothing", ""],
    ["no number at all", "NaN"],
  ])("is the layout's own when what was kept is %s", async (_name, value) => {
    window.localStorage.setItem(WINDOW_KEY, value);
    const { useCoachWindowWidth } = await load();
    expect(renderHook(() => useCoachWindowWidth()).result.current).toBeNull();
  });

  it("is the layout's own when storage cannot be read, and still holds for this window when it cannot be written", async () => {
    window.localStorage.setItem(WINDOW_KEY, "1500");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const blocked = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const { setCoachWindowWidth, useCoachWindowWidth } = await load();
    const reader = renderHook(() => useCoachWindowWidth());
    expect(reader.result.current).toBeNull();
    act(() => setCoachWindowWidth(1_300));
    expect(blocked).toHaveBeenCalled();
    expect(reader.result.current).toBe(1_300);
  });
});

describe("the bars at the window's edges", () => {
  const edge = (side: Side) => screen.getByTestId(`pn-coach-edge-${side}`);
  async function edges() {
    const columns = await load();
    const reader = renderHook(() => columns.useCoachWindowWidth());
    render(
      <>
        <columns.WindowEdge side="left" />
        <columns.WindowEdge side="right" />
      </>,
    );
    return { ...columns, asked: () => reader.result.current };
  }

  it.each(["left", "right"] as const)(
    "the %s one is a slider that says the window's width and its bounds, and takes the mouse",
    async (side) => {
      await edges();
      const slider = screen.getByRole("slider", {
        name: `Width of the window, from its ${side} edge`,
      });
      expect(slider).toBe(edge(side));
      expect(slider).toHaveAttribute("aria-orientation", "horizontal");
      expect(slider).toHaveAttribute("aria-valuemin", "480");
      expect(slider).toHaveAttribute("aria-valuemax", String(SCREEN));
      expect(slider).toHaveAttribute("aria-valuenow", String(WINDOW));
      expect(slider).toHaveAttribute("tabindex", "0");
      expect(slider).toHaveAttribute("data-hit-surface");
    },
  );

  it.each([
    ["left", 100, 60, 1_080],
    ["left", 100, 150, 900],
    ["right", 900, 940, 1_080],
    ["right", 900, 850, 900],
  ] as const)(
    "dragging the %s edge from %i to %i on screen asks for %i px: twice the distance, since the window grows about its centre",
    async (side, from, to, expected) => {
      const { asked } = await edges();
      pointer(edge(side), "Down", from);
      pointer(edge(side), "Move", to);
      expect(asked()).toBe(expected);
      expect(window.localStorage.getItem(WINDOW_KEY)).toBe(String(expected));
      pointer(edge(side), "Up", to);
      expect(asked()).toBe(expected);
    },
  );

  it("measures the drag from where it began, and stops at 480 px and at the screen", async () => {
    const { asked } = await edges();
    pointer(edge("right"), "Down", 900);
    pointer(edge("right"), "Move", 910);
    pointer(edge("right"), "Move", 950);
    expect(asked()).toBe(1_100);
    pointer(edge("right"), "Move", -5_000);
    expect(asked()).toBe(480);
    pointer(edge("right"), "Move", 5_000);
    expect(asked()).toBe(SCREEN);
  });

  it.each(["Up", "Cancel"] as const)(
    "a pointer that only passes over does nothing: before a press, and after pointer %s",
    async (end) => {
      const { asked } = await edges();
      pointer(edge("right"), "Move", 500);
      expect(asked()).toBeNull();
      pointer(edge("right"), "Down", 900);
      pointer(edge("right"), "Move", 920);
      pointer(edge("right"), end, 920);
      pointer(edge("right"), "Move", 990);
      expect(asked()).toBe(1_040);
    },
  );

  it.each([
    ["left", "Up"],
    ["right", "Cancel"],
  ] as const)(
    "the %s edge captures the pointer and tells the shell not to move the window while it is held, until pointer %s",
    async (side, end) => {
      const capture = vi.spyOn(Element.prototype, "setPointerCapture");
      await edges();
      pointer(edge(side), "Down", 300);
      expect(capture).toHaveBeenCalledWith(1);
      expect(held()).toBe(true);
      pointer(edge(side), end, 300);
      expect(held()).toBe(false);
    },
  );

  it.each([
    ["left", "ArrowLeft", 1_048],
    ["left", "ArrowRight", 952],
    ["right", "ArrowRight", 1_048],
    ["right", "ArrowLeft", 952],
  ] as const)(
    "on the %s edge %s moves that edge 24 px, so the window is asked for %i px",
    async (side, key, expected) => {
      const { asked } = await edges();
      expect(fireEvent.keyDown(edge(side), { key })).toBe(false);
      expect(asked()).toBe(expected);
    },
  );

  it("leaves every other key alone", async () => {
    const { asked } = await edges();
    for (const key of ["Home", "End", "Tab", "ArrowDown", "a"])
      expect(fireEvent.keyDown(edge("left"), { key })).toBe(true);
    expect(asked()).toBeNull();
  });

  it("a double click on either gives the window the layout's own width back", async () => {
    const { asked, setCoachWindowWidth } = await edges();
    for (const side of ["left", "right"] as const) {
      act(() => setCoachWindowWidth(1_500));
      expect(asked()).toBe(1_500);
      fireEvent.doubleClick(edge(side));
      expect(asked()).toBeNull();
      expect(window.localStorage.getItem(WINDOW_KEY)).toBeNull();
    }
  });
});
