// The sizes a coach layout keeps. The library's Splitter draws and resizes the
// columns and the room for the call (coach-layout.test.tsx covers the bars);
// this module is only where the sizes are remembered: the Splitters' own, by
// panel id, and the window's width and height, with the reset that puts all
// of it back, and how large the notes read. The module remembers the window's
// width and height and the notes' size in variables, so each test reads it
// fresh.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Columns = typeof import("./coach-columns");
const KEY = "omnitech.interview.coach.sizes";
const WIDTH_KEY = "omnitech.interview.coach.window-width";
const HEIGHT_KEY = "omnitech.interview.coach.window-height";
const SCREEN = { availWidth: 1_600, availHeight: 1_000 };

const load = async (): Promise<Columns> => {
  vi.resetModules();
  return import("./coach-columns");
};
const kept = () => JSON.parse(window.localStorage.getItem(KEY) ?? "null");
const held = () => document.documentElement.hasAttribute("data-no-drag");
// Storage that cannot be read or written (a locked-down profile).
function breakStorage() {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("no storage");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("no storage");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("no storage");
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("screen", SCREEN);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-no-drag");
});

describe("useCoachSizes: the sizes the Splitters keep", () => {
  const mount = async () => {
    const columns = await load();
    return { columns, ...renderHook(() => columns.useCoachSizes()) };
  };

  it("there are none until one is dragged, and nothing is written", async () => {
    const { result } = await mount();
    expect(result.current.sizes).toBeUndefined();
    expect(result.current.resetKey).toBe(0);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("a size is kept by its panel's id, for this window and the next session", async () => {
    const { result } = await mount();
    act(() => result.current.keep({ questions: 180 }));
    expect(result.current.sizes).toEqual({ questions: 180 });
    expect(kept()).toEqual({ questions: 180 });
    // The next session opens with it.
    const next = await mount();
    expect(next.result.current.sizes).toEqual({ questions: 180 });
  });

  it("both Splitters report into the one record: a later report adds to it and replaces only its own panels", async () => {
    const { result } = await mount();
    act(() => result.current.keep({ questions: 180, side: 520 }));
    act(() => result.current.keep({ call: 90 }));
    expect(result.current.sizes).toEqual({
      questions: 180,
      side: 520,
      call: 90,
    });
    act(() => result.current.keep({ side: 300 }));
    expect(result.current.sizes).toEqual({
      questions: 180,
      side: 300,
      call: 90,
    });
    expect(kept()).toEqual({ questions: 180, side: 300, call: 90 });
  });

  it("two reports in the same moment are both kept", async () => {
    const { result } = await mount();
    act(() => {
      result.current.keep({ questions: 180 });
      result.current.keep({ call: 90 });
    });
    expect(result.current.sizes).toEqual({ questions: 180, call: 90 });
    expect(kept()).toEqual({ questions: 180, call: 90 });
  });

  it("a report adds to what an earlier session kept", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ questions: 180 }));
    const { result } = await mount();
    act(() => result.current.keep({ side: 520 }));
    expect(kept()).toEqual({ questions: 180, side: 520 });
  });

  it("a panel folded away (0) stays folded", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ call: 0, side: 0 }));
    const { result } = await mount();
    expect(result.current.sizes).toEqual({ call: 0, side: 0 });
  });

  it("keep and reset are the same functions from draw to draw", async () => {
    const { result, rerender } = await mount();
    const before = result.current;
    act(() => before.keep({ questions: 180 }));
    rerender();
    expect(result.current.keep).toBe(before.keep);
    expect(result.current.reset).toBe(before.reset);
  });

  it.each([
    ["not JSON", "{{"],
    ["a word", '"wide"'],
    ["a number", "250"],
    ["null", "null"],
  ])("there are none when what was kept is %s", async (_name, stored) => {
    window.localStorage.setItem(KEY, stored);
    const { result } = await mount();
    expect(result.current.sizes).toBeUndefined();
  });

  it.each([
    ["a negative size", { questions: -40, side: 520 }],
    ["a word for a size", { questions: "wide", side: 520 }],
    ["a number written as text", { questions: "180", side: 520 }],
    ["nothing for a size", { questions: null, side: 520 }],
  ])(
    "one bad size (%s) is dropped and the other is kept",
    async (_name, stored) => {
      window.localStorage.setItem(KEY, JSON.stringify(stored));
      const { result } = await mount();
      expect(result.current.sizes).toEqual({ side: 520 });
    },
  );

  it("there are none when storage cannot be read, and a size still holds for this window when it cannot be written", async () => {
    breakStorage();
    const { result } = await mount();
    expect(result.current.sizes).toBeUndefined();
    act(() => result.current.keep({ questions: 180 }));
    expect(result.current.sizes).toEqual({ questions: 180 });
  });
});

describe("Reset layout", () => {
  it("forgets every size, tells the Splitters to go back, and keeps nothing for the next session", async () => {
    const columns = await load();
    const { result } = renderHook(() => columns.useCoachSizes());
    act(() => result.current.keep({ questions: 180, side: 520, call: 90 }));
    act(() => result.current.reset());
    expect(result.current.sizes).toBeUndefined();
    expect(result.current.resetKey).toBe(1);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // Each reset is a new one for the Splitters.
    act(() => result.current.reset());
    expect(result.current.resetKey).toBe(2);
  });

  it("a size dragged after a reset starts a new record: nothing from before comes back", async () => {
    const columns = await load();
    const { result } = renderHook(() => columns.useCoachSizes());
    act(() => result.current.keep({ questions: 180, side: 520 }));
    act(() => result.current.reset());
    act(() => result.current.keep({ call: 90 }));
    expect(result.current.sizes).toEqual({ call: 90 });
    expect(kept()).toEqual({ call: 90 });
  });

  it("gives the window back the layout's own width and its own height", async () => {
    const columns = await load();
    const { result } = renderHook(() => ({
      sizes: columns.useCoachSizes(),
      width: columns.useCoachWindowWidth(),
      height: columns.useCoachWindowHeight(),
    }));
    act(() => {
      columns.setCoachWindowWidth(1_200);
      columns.setCoachWindowHeight(800);
    });
    expect([result.current.width, result.current.height]).toEqual([1_200, 800]);
    act(() => result.current.sizes.reset());
    expect([result.current.width, result.current.height]).toEqual([null, null]);
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBeNull();
  });

  it("still resets when storage cannot be written", async () => {
    const columns = await load();
    const { result } = renderHook(() => columns.useCoachSizes());
    act(() => result.current.keep({ questions: 180 }));
    breakStorage();
    act(() => result.current.reset());
    expect(result.current.sizes).toBeUndefined();
    expect(result.current.resetKey).toBe(1);
  });
});

describe("holdWindowDrag: resizing never turns into moving the window", () => {
  it("the whole page says not to move the window while a bar is held, and stops saying so when it is let go", async () => {
    const { holdWindowDrag } = await load();
    expect(held()).toBe(false);
    holdWindowDrag(true);
    expect(held()).toBe(true);
    expect(document.documentElement.getAttribute("data-no-drag")).toBe("");
    holdWindowDrag(false);
    expect(held()).toBe(false);
  });

  it("holding twice or letting go twice changes nothing", async () => {
    const { holdWindowDrag } = await load();
    holdWindowDrag(false);
    expect(held()).toBe(false);
    holdWindowDrag(true);
    holdWindowDrag(true);
    expect(held()).toBe(true);
    holdWindowDrag(false);
    holdWindowDrag(false);
    expect(held()).toBe(false);
  });
});

// The window's width and its height are kept the same way, each with its own
// floor, its own side of the screen and its own key.
describe.each([
  {
    name: "width",
    key: WIDTH_KEY,
    floor: 480,
    most: SCREEN.availWidth,
    avail: "availWidth",
    floorName: "WINDOW_FLOOR",
    set: (columns: Columns) => columns.setCoachWindowWidth,
    use: (columns: Columns) => columns.useCoachWindowWidth,
  },
  {
    name: "height",
    key: HEIGHT_KEY,
    floor: 420,
    most: SCREEN.availHeight,
    avail: "availHeight",
    floorName: "HEIGHT_FLOOR",
    set: (columns: Columns) => columns.setCoachWindowHeight,
    use: (columns: Columns) => columns.useCoachWindowHeight,
  },
] as const)(
  "the window's own $name",
  ({ key, floor, most, avail, floorName, set, use }) => {
    const mount = async () => {
      const columns = await load();
      return {
        columns,
        setSize: set(columns),
        ...renderHook(() => use(columns)()),
      };
    };
    const between = Math.round((floor + most) / 2);

    it(`its floor is ${floor} px`, async () => {
      const columns = await load();
      expect(columns[floorName]).toBe(floor);
    });

    it("is the layout's own (null) until it is dragged, and nothing is written", async () => {
      const { result } = await mount();
      expect(result.current).toBeNull();
      expect(window.localStorage.getItem(key)).toBeNull();
    });

    it("a dragged one is told to everything that reads it, and kept for the next session", async () => {
      const { result, setSize, columns } = await mount();
      const other = renderHook(() => use(columns)());
      act(() => setSize(between));
      expect(result.current).toBe(between);
      expect(other.result.current).toBe(between);
      expect(window.localStorage.getItem(key)).toBe(String(between));
      const next = await mount();
      expect(next.result.current).toBe(between);
    });

    it("stops at its floor and at the screen, and is kept in whole pixels", async () => {
      const { result, setSize } = await mount();
      act(() => setSize(floor - 200));
      expect(result.current).toBe(floor);
      act(() => setSize(0));
      expect(result.current).toBe(floor);
      act(() => setSize(most + 500));
      expect(result.current).toBe(most);
      act(() => setSize(between + 0.6));
      expect(result.current).toBe(between + 1);
      expect(window.localStorage.getItem(key)).toBe(String(between + 1));
    });

    it("where the screen's size is not known, nothing above the floor is cut", async () => {
      vi.stubGlobal("screen", { ...SCREEN, [avail]: 0 });
      const { result, setSize } = await mount();
      act(() => setSize(most + 500));
      expect(result.current).toBe(most + 500);
    });

    it("null gives the layout's own back and forgets what was kept", async () => {
      const { result, setSize } = await mount();
      act(() => setSize(between));
      act(() => setSize(null));
      expect(result.current).toBeNull();
      expect(window.localStorage.getItem(key)).toBeNull();
      const next = await mount();
      expect(next.result.current).toBeNull();
    });

    it.each([
      ["a word", "wide"],
      ["under the floor", String(floor - 1)],
      ["nothing", ""],
      ["negative", "-900"],
      ["not a finite number", "Infinity"],
    ])("what was kept is not used when it is %s", async (_name, stored) => {
      window.localStorage.setItem(key, stored);
      const { result } = await mount();
      expect(result.current).toBeNull();
    });

    it("exactly the floor is kept", async () => {
      window.localStorage.setItem(key, String(floor));
      const { result } = await mount();
      expect(result.current).toBe(floor);
    });

    it("is the layout's own when storage cannot be read, and a dragged one still holds for this window when it cannot be written", async () => {
      breakStorage();
      const { result, setSize } = await mount();
      expect(result.current).toBeNull();
      act(() => setSize(between));
      expect(result.current).toBe(between);
      act(() => setSize(null));
      expect(result.current).toBeNull();
    });

    it("a reader that has gone is no longer told", async () => {
      const { result, setSize, unmount } = await mount();
      act(() => setSize(between));
      unmount();
      act(() => setSize(floor));
      expect(result.current).toBe(between);
    });
  },
);

describe("the window's width and height are kept apart", () => {
  it("setting one leaves the other, in the window and in what is kept", async () => {
    const columns = await load();
    const { result } = renderHook(() => [
      columns.useCoachWindowWidth(),
      columns.useCoachWindowHeight(),
    ]);
    act(() => columns.setCoachWindowWidth(1_200));
    expect(result.current).toEqual([1_200, null]);
    act(() => columns.setCoachWindowHeight(800));
    act(() => columns.setCoachWindowWidth(null));
    expect(result.current).toEqual([null, 800]);
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("800");
  });
});

describe("how large the notes read", () => {
  const TEXT_KEY = "omnitech.interview.coach.text-size";
  const mount = async () => {
    const columns = await load();
    return { columns, ...renderHook(() => columns.useCoachTextSize()) };
  };

  it("there are four sizes, smallest first", async () => {
    expect((await load()).TEXT_SIZES).toEqual(["sm", "md", "lg", "xl"]);
  });

  it("is large until one is chosen, and nothing is written", async () => {
    const { result } = await mount();
    expect(result.current).toBe("lg");
    expect(window.localStorage.getItem(TEXT_KEY)).toBeNull();
  });

  it.each(["sm", "md", "lg", "xl"] as const)(
    "%s, once chosen, is told to everything that reads it and kept for the next session",
    async (size) => {
      const { result, columns } = await mount();
      const other = renderHook(() => columns.useCoachTextSize());
      act(() => columns.setCoachTextSize(size));
      expect(result.current).toBe(size);
      expect(other.result.current).toBe(size);
      expect(window.localStorage.getItem(TEXT_KEY)).toBe(size);
      const next = await mount();
      expect(next.result.current).toBe(size);
    },
  );

  it.each([
    ["a size there is not", "xxl"],
    ["a size in capitals", "XL"],
    ["a number", "19"],
    ["nothing", ""],
  ])("is large when what was kept is %s", async (_name, stored) => {
    window.localStorage.setItem(TEXT_KEY, stored);
    const { result } = await mount();
    expect(result.current).toBe("lg");
  });

  it("is large when storage cannot be read, and a chosen size still holds for this window when it cannot be written", async () => {
    breakStorage();
    const { result, columns } = await mount();
    expect(result.current).toBe("lg");
    act(() => columns.setCoachTextSize("sm"));
    expect(result.current).toBe("sm");
  });

  it("Reset layout leaves it: it is how the notes read, not a size of the layout", async () => {
    const columns = await load();
    const { result } = renderHook(() => ({
      sizes: columns.useCoachSizes(),
      text: columns.useCoachTextSize(),
    }));
    act(() => columns.setCoachTextSize("xl"));
    act(() => result.current.sizes.reset());
    expect(result.current.text).toBe("xl");
    expect(window.localStorage.getItem(TEXT_KEY)).toBe("xl");
  });
});

describe("the layouts offered from the notes pane", () => {
  const mount = async () => {
    const columns = await load();
    return {
      columns,
      ...renderHook(() => ({
        sizes: columns.useCoachSizes(),
        width: columns.useCoachWindowWidth(),
        height: columns.useCoachWindowHeight(),
      })),
    };
  };

  it("are four, the default first, each with a name and what it does", async () => {
    const { COACH_LAYOUTS } = await load();
    expect(COACH_LAYOUTS.map((each) => [each.id, each.label])).toEqual([
      ["default", "Default"],
      ["fill", "Fill the screen"],
      ["notes", "Widest notes"],
      ["no-call", "No room for the call"],
    ]);
    for (const each of COACH_LAYOUTS)
      expect(each.description.length).toBeGreaterThan(10);
  });

  it("the side columns' floors are 180 and 300 px", async () => {
    const columns = await load();
    expect([columns.QUESTIONS_FLOOR, columns.SIDE_FLOOR]).toEqual([180, 300]);
  });

  it("default is the reset: every kept size and the window's own are forgotten, and the Splitters are told to go back", async () => {
    const { result, columns } = await mount();
    act(() => {
      result.current.sizes.keep({ questions: 200, side: 520, call: 90 });
      columns.setCoachWindowWidth(1_200);
      columns.setCoachWindowHeight(800);
    });
    act(() => result.current.sizes.arrange("default"));
    expect(result.current.sizes.sizes).toBeUndefined();
    expect(result.current.sizes.resetKey).toBe(1);
    expect([result.current.width, result.current.height]).toEqual([null, null]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBeNull();
  });

  it("fill asks for the whole of the screen, keeps that, and leaves every column as it is", async () => {
    const { result } = await mount();
    act(() => result.current.sizes.keep({ questions: 200 }));
    act(() => result.current.sizes.arrange("fill"));
    expect([result.current.width, result.current.height]).toEqual([
      SCREEN.availWidth,
      SCREEN.availHeight,
    ]);
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe("1600");
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("1000");
    expect(result.current.sizes.sizes).toEqual({ questions: 200 });
    expect(result.current.sizes.resetKey).toBe(0);
  });

  it("notes takes the side columns to their floors and gives the call no room; the window is left alone", async () => {
    const { result } = await mount();
    act(() => result.current.sizes.arrange("notes"));
    expect(result.current.sizes.sizes).toEqual({
      questions: 180,
      side: 300,
      call: 0,
    });
    expect(kept()).toEqual({ questions: 180, side: 300, call: 0 });
    expect([result.current.width, result.current.height]).toEqual([null, null]);
    expect(result.current.sizes.resetKey).toBe(0);
  });

  it("no-call gives the call no room and leaves the columns as they were kept", async () => {
    const { result } = await mount();
    act(() =>
      result.current.sizes.keep({ questions: 200, side: 520, call: 90 }),
    );
    act(() => result.current.sizes.arrange("no-call"));
    expect(result.current.sizes.sizes).toEqual({
      questions: 200,
      side: 520,
      call: 0,
    });
    expect(kept()).toEqual({ questions: 200, side: 520, call: 0 });
  });

  it("no-call with nothing kept keeps only the call's room", async () => {
    const { result } = await mount();
    act(() => result.current.sizes.arrange("no-call"));
    expect(result.current.sizes.sizes).toEqual({ call: 0 });
  });

  it("default after another layout brings everything back", async () => {
    const { result } = await mount();
    act(() => result.current.sizes.arrange("notes"));
    act(() => result.current.sizes.arrange("fill"));
    act(() => result.current.sizes.arrange("default"));
    expect(result.current.sizes.sizes).toBeUndefined();
    expect([result.current.width, result.current.height]).toEqual([null, null]);
  });

  it("arrange is the same function from draw to draw", async () => {
    const { result, rerender } = await mount();
    const before = result.current.sizes.arrange;
    act(() => result.current.sizes.arrange("notes"));
    rerender();
    expect(result.current.sizes.arrange).toBe(before);
  });
});

describe("useToolbarWidth: the centre column is as wide as the toolbar", () => {
  // The toolbar's pill, as wide as the test says (jsdom lays nothing out).
  function toolbar(width: number) {
    const pill = document.createElement("div");
    pill.className = "pn-toolbar";
    let now = width;
    Object.defineProperty(pill, "offsetWidth", {
      configurable: true,
      get: () => now,
    });
    document.body.append(pill);
    return { pill, grow: (next: number) => (now = next) };
  }
  // A ResizeObserver the test fires by hand.
  function observers() {
    const made: { fire(): void; watched: Element[]; stopped: boolean }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        watched: Element[] = [];
        stopped = false;
        fire: () => void;
        constructor(callback: () => void) {
          this.fire = callback;
          made.push(this);
        }
        observe(element: Element) {
          this.watched.push(element);
        }
        unobserve() {}
        disconnect() {
          this.stopped = true;
        }
      },
    );
    return made;
  }
  afterEach(() => {
    for (const pill of document.querySelectorAll(".pn-toolbar")) pill.remove();
  });

  it("the handles in a row of three columns take 32 px, and the fallback is 560 px", async () => {
    const columns = await load();
    expect(columns.COLUMN_HANDLES).toBe(32);
    expect(columns.TOOLBAR_FALLBACK).toBe(560);
  });

  it("is 560 px where there is no toolbar to measure", async () => {
    const columns = await load();
    const { result } = renderHook(() => columns.useToolbarWidth());
    expect(result.current).toBe(560);
  });

  it("is the toolbar's own width where there is one", async () => {
    toolbar(640);
    const columns = await load();
    const { result } = renderHook(() => columns.useToolbarWidth());
    expect(result.current).toBe(640);
  });

  it("is 560 px while the toolbar has no width yet", async () => {
    toolbar(0);
    const columns = await load();
    const { result } = renderHook(() => columns.useToolbarWidth());
    expect(result.current).toBe(560);
  });

  it("follows the toolbar as it grows with its labels, and stops once its reader has gone", async () => {
    const made = observers();
    const { pill, grow } = toolbar(640);
    const columns = await load();
    const { result, unmount } = renderHook(() => columns.useToolbarWidth());
    expect(made).toHaveLength(1);
    expect(made[0]?.watched).toEqual([pill]);
    grow(712);
    act(() => made[0]?.fire());
    expect(result.current).toBe(712);
    unmount();
    expect(made[0]?.stopped).toBe(true);
  });

  it("still measures once where the window has no ResizeObserver", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    toolbar(640);
    const columns = await load();
    const { result } = renderHook(() => columns.useToolbarWidth());
    expect(result.current).toBe(640);
  });
});
