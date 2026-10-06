// See-through pass-through, page side: the surface table, the bounded report,
// when a report is sent, and its reaction to the DOM.
import type {
  HitRegion,
  PresentationHost,
} from "@omnitech/interview-contracts";
import { HIT_REGION_LIMITS } from "@omnitech/interview-contracts";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundRegions,
  canPassThrough,
  HIT_DEBOUNCE_MS,
  HIT_HEARTBEAT_MS,
  HIT_SELECTORS,
  measureSurfaces,
  regionsToSend,
  sameRegions,
  useHitRegions,
} from "./hit-regions";
import { noopPresentation } from "./presentation-host";

const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

describe("surface table", () => {
  it("always includes the toolbar, so See-through can be turned off with the mouse", () => {
    expect(HIT_SELECTORS).toContain(".pn-pill");
    for (const surface of [
      ".pn-strip",
      ".pn-card",
      ".pn-single-foot",
      ".pn-menu",
      ".pn-toast",
      ".ss-viewer-scrim",
      // The sign-in and start screens: with clear glass on, clicks on them must
      // reach the page, not the app underneath.
      ".pn-start-card",
      ".pn-start-toast",
    ])
      expect(HIT_SELECTORS).toContain(surface);
  });
});

describe("the report", () => {
  it("is null while See-through is off, the bounded rectangles while on", () => {
    expect(regionsToSend(false, [rect(0, 0, 10, 10)])).toBeNull();
    expect(regionsToSend(true, [rect(0, 0, 10, 10)])).toEqual([
      rect(0, 0, 10, 10),
    ]);
    // On with nothing measured: an empty list, everything passes through.
    expect(regionsToSend(true, [])).toBeNull();
  });

  it("drops what the shell would refuse: non-finite, empty or negative sizes, duplicates", () => {
    expect(
      boundRegions([
        rect(Number.NaN, 0, 10, 10),
        rect(0, Number.POSITIVE_INFINITY, 10, 10),
        rect(0, 0, 0, 10),
        rect(0, 0, 10, -2),
        rect(5, 5, 10, 10),
        rect(5, 5, 10, 10),
      ]),
    ).toEqual([rect(5, 5, 10, 10)]);
  });

  it("clamps a side to the wire limit", () => {
    expect(
      boundRegions([rect(0, 0, HIT_REGION_LIMITS.maxSide + 500, 10)]),
    ).toEqual([rect(0, 0, HIT_REGION_LIMITS.maxSide, 10)]);
  });

  it("never exceeds the rectangle limit and never drops a surface: the overflow is folded into one covering rectangle", () => {
    const many = Array.from({ length: 80 }, (_, i) => rect(i * 3, 0, 2, 10));
    const bound = boundRegions(many);
    expect(bound).toHaveLength(HIT_REGION_LIMITS.maxRects);
    const folded = bound.at(-1) as HitRegion;
    // The 17 folded rectangles (indexes 63..79) are all inside it.
    for (const original of many.slice(HIT_REGION_LIMITS.maxRects - 1)) {
      expect(folded.x).toBeLessThanOrEqual(original.x);
      expect(folded.x + folded.width).toBeGreaterThanOrEqual(
        original.x + original.width,
      );
    }
    expect(bound.slice(0, -1)).toEqual(many.slice(0, 63));
  });

  it("compares reports by value", () => {
    expect(sameRegions(null, null)).toBe(true);
    expect(sameRegions([], null)).toBe(false);
    expect(sameRegions([rect(1, 2, 3, 4)], [rect(1, 2, 3, 4)])).toBe(true);
    expect(sameRegions([rect(1, 2, 3, 4)], [rect(1, 2, 3, 5)])).toBe(false);
  });
});

// jsdom has no layout: give an element a fixed box.
function box(element: Element, r: ReturnType<typeof rect>) {
  element.getBoundingClientRect = () =>
    ({
      left: r.x,
      top: r.y,
      width: r.width,
      height: r.height,
      right: r.x + r.width,
      bottom: r.y + r.height,
    }) as DOMRect;
}

describe("measuring the document", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes each listed surface that has a size, anywhere in the document, and nothing else", () => {
    document.body.innerHTML = `
      <div class="pn-root">
        <div class="pn-pill"></div><div class="pn-strip"></div>
        <div class="pn-card"></div><div class="pn-card" hidden></div>
        <div class="pn-empty-area"></div>
      </div>
      <div class="ss-viewer-scrim"></div>`;
    const [pill, strip, card, , , scrim] = [
      ...document.querySelectorAll("div"),
    ].slice(1);
    box(pill as Element, rect(8, 8, 300, 40));
    box(strip as Element, rect(8, 56, 300, 20));
    box(card as Element, rect(8, 84, 140, 200));
    box(scrim as Element, rect(0, 0, 800, 600));
    expect(measureSurfaces()).toEqual([
      rect(8, 8, 300, 40),
      rect(8, 56, 300, 20),
      rect(8, 84, 140, 200),
      rect(0, 0, 800, 600),
    ]);
  });
});

describe("useHitRegions", () => {
  const host = (calls: unknown[], over: Partial<PresentationHost> = {}) =>
    ({
      ...noopPresentation,
      capabilities: ["hit-regions"],
      setHitRegions: async (regions: unknown) => {
        calls.push(regions);
        return true;
      },
      ...over,
    }) as PresentationHost;

  function Probe({
    presentation,
    active,
  }: {
    presentation: PresentationHost;
    active: boolean;
  }) {
    useHitRegions(presentation, active);
    return (
      <div
        className="pn-pill"
        ref={(el) => {
          if (el) box(el, rect(1, 2, 3, 4));
        }}
      />
    );
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("is possible only with the capability and the method", () => {
    expect(canPassThrough(noopPresentation)).toBe(false);
    expect(canPassThrough(host([]))).toBe(true);
    expect(canPassThrough(host([], { capabilities: [] } as never))).toBe(false);
  });

  it("sends nothing while off, the surfaces the moment it is on, and null when it goes off", () => {
    const calls: unknown[] = [];
    const presentation = host(calls);
    const view = render(<Probe presentation={presentation} active={false} />);
    expect(calls).toEqual([]);
    view.rerender(<Probe presentation={presentation} active={true} />);
    expect(calls).toEqual([[rect(1, 2, 3, 4)]]);
    view.rerender(<Probe presentation={presentation} active={false} />);
    expect(calls.at(-1)).toBeNull();
  });

  it("sends null when unmounted, and again after a reload (a fresh mount sends the surfaces)", () => {
    const calls: unknown[] = [];
    const presentation = host(calls);
    const view = render(<Probe presentation={presentation} active={true} />);
    view.unmount();
    expect(calls.at(-1)).toBeNull();
    render(<Probe presentation={presentation} active={true} />);
    expect(calls.at(-1)).toEqual([rect(1, 2, 3, 4)]);
  });

  it("repeats the report on a beat well inside the shell's stale limit, so a silent page can be told from a still one", () => {
    const calls: unknown[] = [];
    render(<Probe presentation={host(calls)} active={true} />);
    const before = calls.length;
    act(() => {
      vi.advanceTimersByTime(HIT_HEARTBEAT_MS + 10);
    });
    expect(calls.length).toBe(before + 1);
    expect(HIT_HEARTBEAT_MS * 3).toBeLessThanOrEqual(15_000);
  });

  it("releases the mask when the page becomes hidden, stays silent while hidden, and reports again when shown", () => {
    const calls: unknown[] = [];
    let state: DocumentVisibilityState = "visible";
    const spy = vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => state);
    try {
      render(<Probe presentation={host(calls)} active={true} />);
      expect(calls).toEqual([[rect(1, 2, 3, 4)]]);
      // The shell ordered this window out (expanded form): release, and the heartbeat must not re-report.
      state = "hidden";
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(calls.at(-1)).toBeNull();
      const afterRelease = calls.length;
      act(() => {
        vi.advanceTimersByTime(HIT_HEARTBEAT_MS * 3);
      });
      expect(calls).toHaveLength(afterRelease);
      state = "visible";
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(calls.at(-1)).toEqual([rect(1, 2, 3, 4)]);
    } finally {
      spy.mockRestore();
    }
  });

  it("follows a change in the document after a short pause, and does not repeat an unchanged report", async () => {
    const calls: unknown[] = [];
    render(<Probe presentation={host(calls)} active={true} />);
    expect(calls).toHaveLength(1);
    const extra = document.createElement("div");
    extra.className = "pn-menu";
    box(extra, rect(10, 60, 100, 80));
    document.body.append(extra);
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(HIT_DEBOUNCE_MS + 5);
    });
    expect(calls).toHaveLength(2);
    expect(calls.at(-1)).toEqual([rect(1, 2, 3, 4), rect(10, 60, 100, 80)]);
    // A change that moves nothing sends nothing.
    extra.setAttribute("class", "pn-menu");
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(HIT_DEBOUNCE_MS + 5);
    });
    expect(calls).toHaveLength(2);
  });

  it("does nothing on a host that cannot pass clicks through", () => {
    const calls: unknown[] = [];
    render(
      <Probe
        presentation={host(calls, { capabilities: [] } as never)}
        active={true}
      />,
    );
    expect(calls).toEqual([]);
  });

  describe("surfaces that change without a DOM change", () => {
    class FakeResizeObserver {
      static instances: FakeResizeObserver[] = [];
      observed = new Set<Element>();
      constructor(public callback: () => void) {
        FakeResizeObserver.instances.push(this);
      }
      observe(el: Element) {
        this.observed.add(el);
      }
      unobserve(el: Element) {
        this.observed.delete(el);
      }
      disconnect() {
        this.observed.clear();
      }
    }
    beforeEach(() => {
      FakeResizeObserver.instances = [];
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("observes each matched surface and follows the set as surfaces come and go", async () => {
      const calls: unknown[] = [];
      render(<Probe presentation={host(calls)} active={true} />);
      const observer = FakeResizeObserver.instances[0] as FakeResizeObserver;
      expect([...observer.observed].some((el) => el.matches(".pn-pill"))).toBe(
        true,
      );
      const menu = document.createElement("div");
      menu.className = "pn-menu";
      box(menu, rect(10, 60, 100, 80));
      document.body.append(menu);
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(HIT_DEBOUNCE_MS + 5);
      });
      expect(observer.observed.has(menu)).toBe(true);
      // Its size changes with no DOM change (a thumbnail decoded): the
      // surface's own observer reports it.
      box(menu, rect(10, 60, 100, 250));
      act(() => {
        observer.callback();
        vi.advanceTimersByTime(HIT_DEBOUNCE_MS + 5);
      });
      expect(calls.at(-1)).toEqual([rect(1, 2, 3, 4), rect(10, 60, 100, 250)]);
      menu.remove();
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(HIT_DEBOUNCE_MS + 5);
      });
      expect(observer.observed.has(menu)).toBe(false);
    });

    it("re-measures when an image finishes loading (load does not bubble)", () => {
      const calls: unknown[] = [];
      render(<Probe presentation={host(calls)} active={true} />);
      const before = calls.length;
      const pill = document.querySelector(".pn-pill") as HTMLElement;
      box(pill, rect(1, 2, 3, 99));
      act(() => {
        pill.dispatchEvent(new Event("load"));
        vi.advanceTimersByTime(HIT_DEBOUNCE_MS + 5);
      });
      expect(calls.length).toBe(before + 1);
      expect(calls.at(-1)).toEqual([rect(1, 2, 3, 99)]);
    });

    it("sends null, not an empty list, when no surface is found", () => {
      const calls: unknown[] = [];
      function Bare() {
        useHitRegions(host(calls), true);
        return null;
      }
      render(<Bare />);
      expect(calls).toEqual([null]);
    });
  });
});
