// The two lists the page publishes to the shell's drag and cursor probe
// (`data-drag-chrome`, `data-text-surfaces`): non-empty, the same constants the
// CSS uses, and each one matches what the swapped toolbar, footer, transcript,
// answer and code panels really render.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PresentationHost } from "@omnitech/interview-contracts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../../focus-presentation";
import { resetScreenProblems } from "../../screen-problems";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import { answerAction } from "../../testing/live-view-kit";
import {
  action,
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
  transcript,
} from "../../testing/session-fixtures";
import {
  codeResult,
  codingAnswer,
} from "../../testing/session-result-fixtures";
import { createTestServer } from "../../testing/session-test-server";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";
import {
  DRAG_CHROME_SELECTORS,
  TEXT_SURFACE_SELECTORS,
  useHitRegions,
} from "./hit-regions";
import { noopPresentation } from "./presentation-host";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "panels.css"),
  "utf8",
);
const drag = DRAG_CHROME_SELECTORS.join(",");
const text = TEXT_SURFACE_SELECTORS.join(",");
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

describe("the published lists", () => {
  it("are non-empty, and the text list is the one panels.css uses for the text cursor", () => {
    expect(DRAG_CHROME_SELECTORS.length).toBeGreaterThan(0);
    expect(TEXT_SURFACE_SELECTORS.length).toBeGreaterThan(0);
    const at = css.indexOf("cursor: text;");
    const rule = css.slice(css.lastIndexOf(":is(", at), at);
    for (const selector of TEXT_SURFACE_SELECTORS)
      expect(rule, selector).toContain(selector);
    // Nothing in the CSS list that the page does not publish.
    const listed = rule
      .slice(rule.indexOf("(") + 1, rule.lastIndexOf(")"))
      .split(/,\s*(?![^(]*\))/)
      .map((each) => each.trim())
      .filter(Boolean);
    expect(listed.sort()).toEqual([...TEXT_SURFACE_SELECTORS].sort());
  });

  it("use app-owned hooks, never library or retired class names", () => {
    for (const selector of [
      ...DRAG_CHROME_SELECTORS,
      ...TEXT_SURFACE_SELECTORS,
    ])
      expect(selector).not.toMatch(
        /\.(oui|pn-log|pn-interim|pn-analysis|pn-codecard)/,
      );
  });

  it("are written on <html> while the host talks to the shell, and removed after", () => {
    const host = {
      ...noopPresentation,
      capabilities: ["hit-regions"],
      setHitRegions: async () => true,
    } as PresentationHost;
    function Probe({ on }: { on: PresentationHost }) {
      useHitRegions(on, false);
      return null;
    }
    const view = render(<Probe on={host} />);
    const root = document.documentElement;
    expect(root.getAttribute("data-drag-chrome")).toBe(drag);
    expect(root.getAttribute("data-text-surfaces")).toBe(text);
    view.unmount();
    expect(root.hasAttribute("data-drag-chrome")).toBe(false);
    expect(root.hasAttribute("data-text-surfaces")).toBe(false);
    render(<Probe on={noopPresentation} />);
    expect(root.hasAttribute("data-text-surfaces")).toBe(false);
  });
});

describe("the lists match what the swapped panels render", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(minutesAfter(1, 10)));
    window.localStorage.clear();
    resetSessionStores();
    presentation.reset();
    resetCommandClaims();
    resetScreenProblems();
    const session = sessionView({ processingPolicy: "permitted-remote" });
    const server = createTestServer(() =>
      streamPage({
        session,
        observations: [snapshot(1), transcript(2, "Walk me through it.")],
        nextAfterSequence: 2,
        actions: [
          answerAction(codingAnswer([], "Rate limiter"), {
            createdAt: minutesAfter(1),
            updatedAt: minutesAfter(1, 5),
            generatedBy: { runtime: "claude-code", model: "claude-sonnet-5-5" },
            sourceSnapshots: [{ sourceId: "screen", eventId: "evt-1" }],
          }),
          action({
            actionKind: "solve-code",
            result: codeResult(),
            createdAt: minutesAfter(1, 6),
            updatedAt: minutesAfter(1, 9),
          }),
        ] as never,
        serverNow: minutesAfter(1, 10),
      }),
    );
    server.on("GET /current", () => jsonResponse({ session }));
    server.on("GET /:id", () => jsonResponse({ session }));
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
      submitFollowUp: async () => undefined,
    });
  });
  afterEach(() => {
    cleanup();
    resetSessionStores();
    vi.useRealTimers();
  });

  it("drags by the toolbar and the footer; reads and copies the transcript, answer, code, strip and notes", async () => {
    window.history.replaceState(
      {},
      "",
      "/t/local/p/interview/live/overlay?panel=single&host=native",
    );
    render(<OverlayPage />);
    await flush();
    await flush();
    const toolbar = screen.getByRole("toolbar", { name: "Session controls" });
    const footer = document.querySelector(".pn-single-foot") as HTMLElement;
    expect(toolbar.closest(drag)).not.toBeNull();
    expect(footer.closest(drag)).not.toBeNull();
    const transcriptLog = document.querySelector('[data-slot="transcript"]');
    expect(transcriptLog).not.toBeNull();
    for (const [name, element] of [
      ["transcript", transcriptLog],
      ["answer", document.querySelector(".pn-answer-panel")],
      ["code", document.querySelector(".pn-code-body")],
      ["strip", document.querySelector(".pn-strip-main")],
    ] as const) {
      expect(element, name).not.toBeNull();
      expect(element?.closest(text), name).not.toBeNull();
    }
    // The toolbar and footer are chrome, not text: they never take the text cursor.
    expect(toolbar.matches(text)).toBe(false);
    expect(footer.matches(text)).toBe(false);
  });
});
