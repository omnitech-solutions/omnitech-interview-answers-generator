// The UI migration guard (native-swap cleanup plan, sections 0 to 2): the old
// Studio UI is gone and stays gone. Everything reads the one manifest in
// ui-migration-audit.ts; this file only asserts and prints the count report.
import { describe, expect, it } from "vitest";
import {
  countReport,
  cssReport,
  formatCounts,
  type Hit,
  judgeRaw,
  rawAllowList,
  rawPrimitiveCounts,
  retiredUi,
  type Scan,
  scanFrontend,
} from "./ui-migration-audit";

const scan: Scan = scanFrontend();
// Classes the CSS names that are not ours: CodeMirror and the assistant
// library's own DOM, and the Swift shell's drag probe (WindowDrag.swift owns
// `.pn-pill,.pn-single-foot` and the `typing` list; panels.css must keep them).
const EXTERNAL = new Set([
  "cm-scroller",
  "cm-gutters",
  "cm-content",
  "cm-theme-dark",
  "oa-host",
  "oa-icon",
]);
const css = cssReport(scan, EXTERNAL);
const show = (hits: Hit[]) =>
  hits.map((h) => `${h.file}:${h.line} ${h.detail}`);

describe("UI migration audit", () => {
  it("prints the count report", () => {
    console.info(formatCounts(countReport(scan, css)));
    expect(scan.files.length).toBeGreaterThan(300);
  });

  it("no code imports, re-exports or recreates a retired module or component", () => {
    const hits = scan.hits.filter(
      (h) => h.kind === "import" || h.kind === "component",
    );
    expect(show(hits)).toEqual([]);
  });

  it("no string, template or clsx/cn argument names a retired class family", () => {
    expect(show(scan.hits.filter((h) => h.kind === "string"))).toEqual([]);
  });

  it("no stylesheet selects a retired class or reads a retired variable", () => {
    expect(css.retired.map((s) => `${s.file}:${s.line} .${s.name}`)).toEqual(
      [],
    );
    expect(
      css.retiredVariables.map((v) => `${v.file}:${v.line} ${v.name}`),
    ).toEqual([]);
  });

  it("every class selector is named by shipped code (or is external)", () => {
    expect(
      css.unreferenced.map((s) => `${s.file}:${s.line} .${s.name}`),
    ).toEqual([]);
  });

  it("the manifest is non-empty (a guard that checks nothing passes)", () => {
    expect(retiredUi.modules.length).toBeGreaterThan(0);
    expect(retiredUi.cssSelectors.length).toBeGreaterThan(0);
  });

  describe("raw primitive audit", () => {
    const verdict = judgeRaw(rawPrimitiveCounts(scan.raw), rawAllowList);

    it("every raw button/input/select/textarea/dialog/table is allow-listed", () => {
      expect(verdict.unlisted).toEqual([]);
    });
    it("the allow-list only shrinks: no entry allows more than exists", () => {
      expect(verdict.stale).toEqual([]);
    });
    it("every allow-list entry carries a reason", () => {
      expect(verdict.unreasoned).toEqual([]);
    });
  });
});
