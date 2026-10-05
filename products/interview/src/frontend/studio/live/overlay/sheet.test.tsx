// The region editor as a full-window sheet, and menus that stay inside the card.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCardHost } from "../card-host";
import { presentation } from "../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../session-registry";
import { answerAction } from "../testing/live-view-kit";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../testing/session-fixtures";
import { answerResult } from "../testing/session-result-fixtures";
import { createTestServer } from "../testing/session-test-server";
import { resetPosition } from "./card-position";
import { placeMenu } from "./menu-placement";
import { OverlayPage } from "./overlay-page";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "overlay.css"),
  "utf8",
);
// Every declaration block whose selector is exactly this one.
const rule = (selector: string): string =>
  [
    ...css.matchAll(
      new RegExp(
        `(?:^|\\n)${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`,
        "g",
      ),
    ),
  ]
    .map((match) => match[1])
    .join("\n");

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await flush();
};

async function openCard() {
  const view = sessionView({ processingPolicy: "permitted-remote" });
  const server = createTestServer(() =>
    streamPage({
      session: view,
      observations: [snapshot(1)],
      nextAfterSequence: 1,
      actions: [answerAction(answerResult())],
    }),
  );
  server.on("GET /current", () => jsonResponse({ session: view }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
  return server;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetPosition();
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the region editor sheet", () => {
  async function openEditor() {
    await openCard();
    render(<LiveCardHost />);
    act(() => presentation.setMode("card"));
    await settle();
    // Alt+M, from the capture button: the editor returns focus to it.
    const opener = screen.getByRole("button", { name: /Capture & analyze/ });
    opener.focus();
    fireEvent.keyDown(opener, { key: "µ", code: "KeyM", altKey: true });
    await flush();
    return opener;
  }

  it("opens as a sheet portalled to the page body, not inside the card", async () => {
    await openEditor();
    const sheet = screen.getByTestId("mask-sheet");
    expect(sheet.parentElement).toBe(document.body);
    expect(screen.getByTestId("overlay-card").contains(sheet)).toBe(false);
    expect(sheet).toHaveClass("ov-sheet");
    const dialog = within(sheet).getByRole("dialog", {
      name: "Choose capture area",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("covers the whole window, with the preview taking the room the toolbar leaves", () => {
    const sheet = rule(".ov-sheet");
    expect(sheet).toMatch(/position:\s*fixed/);
    expect(sheet).toMatch(/inset:\s*0/);
    // The preview area grows; the toolbar does not.
    expect(rule(".ov-stage-wrap")).toMatch(/flex:\s*1/);
    expect(rule(".ov-stage-wrap")).toMatch(/container-type:\s*size/);
    expect(rule(".ov-stage")).toMatch(
      /min\(100cqw,\s*calc\(100cqh \* var\(--aspect/,
    );
    expect(rule(".ov-sheet-foot")).toMatch(/flex:\s*none/);
    // The sheet carries the card's colours (it is outside the card).
    expect(css).toMatch(/\.ov-card,\s*\.ov-root,\s*\.ov-sheet \{/);
  });

  it("pins the presets, Reset, Cancel and Save in the toolbar at the bottom", async () => {
    await openEditor();
    const foot = within(screen.getByTestId("mask-foot"));
    for (const name of [
      "Everything",
      "Left side",
      "Right side",
      "Top",
      "Bottom",
      "Middle",
      "Reset",
      "Cancel",
      "Save region",
    ])
      expect(foot.getByRole("button", { name })).toBeVisible();
    const dialog = screen.getByTestId("mask-editor");
    expect(dialog.lastElementChild).toBe(screen.getByTestId("mask-foot"));
  });

  it("puts the preview's own aspect ratio on the stage", async () => {
    await openEditor();
    const stage = screen
      .getByTestId("mask-editor")
      .querySelector(".ov-stage") as HTMLElement;
    expect(stage.style.getPropertyValue("--aspect")).not.toBe("");
  });

  it("closes on Escape and returns focus to what opened it", async () => {
    const opener = await openEditor();
    expect(document.activeElement).toBe(screen.getByTestId("mask-rect"));
    fireEvent.keyDown(screen.getByTestId("mask-rect"), { key: "Escape" });
    await flush();
    expect(screen.queryByTestId("mask-sheet")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus inside while open: Tab wraps both ways", async () => {
    await openEditor();
    const rect = screen.getByTestId("mask-rect");
    const save = screen.getByRole("button", { name: "Save region" });
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(document.activeElement).toBe(rect);
    fireEvent.keyDown(rect, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
    // From outside the sheet, Shift+Tab pulls focus back in.
    (document.body as HTMLElement).focus();
    fireEvent.keyDown(screen.getByTestId("mask-editor"), {
      key: "Tab",
      shiftKey: true,
    });
    expect(
      screen.getByTestId("mask-editor").contains(document.activeElement),
    ).toBe(true);
  });

  it("fills the window in the standalone overlay page too, again as a body sheet", async () => {
    await openCard();
    window.history.replaceState({}, "", "/t/local/p/interview/live/overlay");
    render(<OverlayPage />);
    await settle();
    fireEvent.keyDown(screen.getByTestId("overlay-card"), {
      key: "µ",
      code: "KeyM",
      altKey: true,
    });
    const sheet = screen.getByTestId("mask-sheet");
    expect(sheet.parentElement).toBe(document.body);
    expect(screen.getByTestId("overlay-root").contains(sheet)).toBe(false);
  });
});

describe("menu placement", () => {
  const bound = { left: 0, top: 0, right: 320, bottom: 300 };
  const menu = { left: 0, top: 0, right: 280, bottom: 0 };

  it("goes below the anchor when it fits", () => {
    const anchor = { left: 0, top: 20, right: 320, bottom: 60 };
    expect(placeMenu({ anchor, bound, menu, height: 120 })).toEqual({
      side: "below",
      maxHeight: 120,
      shiftX: 0,
    });
  });

  it("scrolls inside when it does not fit and there is no better side", () => {
    const anchor = { left: 0, top: 20, right: 320, bottom: 60 };
    const placed = placeMenu({ anchor, bound, menu, height: 600 });
    expect(placed.side).toBe("below");
    expect(placed.maxHeight).toBe(300 - 60 - 4 - 8);
  });

  it("flips above when there is more room there", () => {
    const anchor = { left: 0, top: 230, right: 320, bottom: 280 };
    const placed = placeMenu({ anchor, bound, menu, height: 400 });
    expect(placed.side).toBe("above");
    expect(placed.maxHeight).toBe(230 - 4 - 8);
  });

  it("never gets smaller than a few rows", () => {
    const anchor = { left: 0, top: 10, right: 320, bottom: 290 };
    expect(
      placeMenu({ anchor, bound, menu, height: 400 }).maxHeight,
    ).toBeGreaterThanOrEqual(96);
  });

  it("shifts sideways to stay inside the card", () => {
    const anchor = { left: 0, top: 20, right: 320, bottom: 60 };
    expect(
      placeMenu({
        anchor,
        bound,
        menu: { left: -30, top: 0, right: 250, bottom: 0 },
        height: 100,
      }).shiftX,
    ).toBe(30);
    expect(
      placeMenu({
        anchor,
        bound,
        menu: { left: 90, top: 0, right: 370, bottom: 0 },
        height: 100,
      }).shiftX,
    ).toBe(-50);
    // Wider than the card: lined up with its left edge.
    expect(
      placeMenu({
        anchor,
        bound,
        menu: { left: 5, top: 0, right: 400, bottom: 0 },
        height: 100,
      }).shiftX,
    ).toBe(-5);
  });

  describe("applied to a menu in the card", () => {
    function layout(anchor: { top: number; bottom: number }) {
      Object.defineProperty(HTMLElement.prototype, "offsetParent", {
        get(this: HTMLElement) {
          return this.parentElement;
        },
        configurable: true,
      });
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        get: () => 400,
        configurable: true,
      });
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        const box = (l: number, t: number, r: number, b: number) =>
          ({
            left: l,
            top: t,
            right: r,
            bottom: b,
            width: r - l,
            height: b - t,
            x: l,
            y: t,
            toJSON: () => ({}),
          }) as DOMRect;
        if (this.classList.contains("ov-card")) return box(0, 0, 320, 300);
        if (this.classList.contains("ov-capture"))
          return box(0, anchor.top, 320, anchor.bottom);
        if (this.classList.contains("ov-menu"))
          return box(0, anchor.bottom, 280, anchor.bottom + 400);
        return box(0, 0, 0, 0);
      });
    }
    async function openMenu() {
      await openCard();
      render(<LiveCardHost />);
      act(() => presentation.setMode("card"));
      await settle();
      fireEvent.click(
        screen.getByRole("button", { name: /Capture & analyze/ }),
      );
      await flush();
      return screen.getByRole("menu", { name: "Capture source" });
    }

    it("limits its height to the room below and scrolls", async () => {
      layout({ top: 100, bottom: 150 });
      const el = await openMenu();
      expect(el.style.maxHeight).toBe("138px");
      expect(el.style.top).toBe("54px");
      expect(el.style.overflowY).toBe("auto");
    });

    it("flips above the anchor when it is low in the card", async () => {
      layout({ top: 230, bottom: 280 });
      const el = await openMenu();
      expect(el.style.bottom).toBe("54px");
      expect(el.style.top).toBe("auto");
      expect(el.style.maxHeight).toBe("218px");
    });
  });
});
