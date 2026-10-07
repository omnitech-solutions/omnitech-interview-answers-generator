# Native rework cleanup plan: prove the migration is complete

Rule 1 of the rework: the old UI goes. This plan is how that is PROVEN, not assumed. It treats cleanup as a
migration-completeness problem: the old UI can survive as direct imports, re-exports, aliases, inline JSX that
recreates a component, copied CSS, helper wrappers, dynamic strings, tests/fixtures, and string contracts with the
Swift shell. `rg` alone cannot see most of those, so the checks are layered. It runs at the END, after every track
has merged into `native-swap`, so the checks are written against the finished state. Nothing here is deleted
until the replacement passes its contract tests.

## 0. One manifest drives everything

`scripts/ui-migration-audit.ts` holds ONE retired-symbol manifest; every check below reads it (no per-component
bespoke tests):

```ts
export const retiredUi = {
  components: ["Button (from ui/button)", "BUTTON_VARIANTS", "StudioButton-style wrappers"],
  modules: ["ui/button", "ui/ui.css", "ui/join", "panels/popover", "panels/status-strip"],
  cssSelectors: [".studio-button", ".pn-primary", ".pn-codecard", ".pn-analysis-text", ".ov-footer", ".ov-confirm", ".ov-build", ".ov-clock"],
  cssVariables: ["--ui-*" button roles once nothing reads them"],
  bridgeContracts: [], // filled from section 5 (Swift <-> web)
};
```

Entries are added as each track reports what it deleted (track reports already list the deleted classes). The audit
FAILS on any hit and prints a count report: `Raw <button>: n, <input>: n, <select>: n, <textarea>: n, <dialog>: n,
<table>: n, legacy imports: n, legacy selectors: n, legacy strings: n`.

## 1. AST layer (TypeScript compiler API: already a dependency, no new tool)

The audit parses every `.ts/.tsx` under `products/*/src/frontend` and `apps/web` with `ts.createSourceFile` and fails on:
- an import or re-export (`export *`, `export { X } from`, barrels such as `ui/index.ts`) of a retired module;
- an aliased import (`import { Button as UiButton } from ...`) or a JSX element / `React.createElement(...)` whose
  tag resolves to a retired symbol;
- inline recreation: any string literal, template literal piece, or `clsx`/`cn` argument containing a retired class
  family (`studio-button`, `pn-primary`, ...), so `<button className={cn("studio-button", x)}>` is caught;
- the RAW PRIMITIVE AUDIT: JSX `<button> <input> <select> <textarea> <dialog> <table>` and checkbox/radio-like
  inputs inside the migrated surfaces (`studio/live/overlay/panels`, `studio/live/overlay`, Studio pages). Each hit is
  either replaced by the library control or put in a short allow-list WITH a reason (CodeMirror, native selects the tests
  drive, hidden file inputs). The allow-list is a ratchet: it may shrink, never grow.
Alternatives considered: ast-grep and ts-morph are good, but add a binary/dependency for what the compiler API already
does here. Biome's `noRestrictedImports` is ALSO extended with the retired module paths so the pre-commit hook blocks a
re-import immediately (the repo already uses that rule).

## 2. Orphaned CSS (its own pass)

A component can vanish and leave hundreds of lines. The audit collects every class selector from `panels.css`,
`overlay.css`, `start-panel.css`, `screen-picker.css`, `code-canvas.css`, the Studio CSS and `ui/*.css`, and every
string the AST layer found, then reports (a) selectors in the retired manifest, (b) selectors no code references,
(c) retired CSS variables. Each unreferenced selector is deleted or kept with a one-line reason (dynamic class names,
`data-` attribute selectors, pinned by `panels-css.test.ts`). Known leftovers from the track reports to resolve:
`.pn-chip*`, `.pn-mini-button`, `.ov-status`, `.ov-menu*`, `.ov-field`, `.ov-select`, `.ov-shortcut*`, `.pn-display-*`,
`.pn-start-toast`, `pn-sr`. Also: old animation names, legacy theme tokens, selectors that depend on the DOM of
removed components.

## 3. Reachability, dead files and exports (Knip)

After the swap, run Knip (dev dependency, configured for the monorepo: Next entrypoints, stories/tests, workers,
scripts, dynamic imports) to report unused files, exports, types and dependencies. First run is REPORT-ONLY; nothing is
deleted from the report blindly (dynamic imports and framework conventions give false positives): each finding is
confirmed by the dependency graph question "who can reach this from a real entrypoint?", including through barrels
(`export * from`). Known candidates: `panels/popover.tsx` (after the toolbar track), `revisions-control.tsx` users,
the legacy overlay-card path (`overlay-card.tsx`, `chat-log.tsx`, `command-bar.tsx`, `overlay-capture.tsx`,
`overlay-task.tsx`: audit reachability in the single native window FIRST; port what is reachable, delete the rest and
record the finding). Knip adds a dependency, so under AGENTS.md rule 1 this is the scope checkpoint: it is added
as a dev tool only, with no runtime impact. Also: `tsc --noEmit` (already in verify) and, where practical,
`noUnusedLocals`/`noUnusedParameters`.

## 4. Order of work and exit criteria

1. Merge all tracks (B, C1 still running). 2. Full gate once on `native-swap`. 3. Fill the manifest from the track
reports. 4. Write the audit (sections 1-2) and run it: fix every hit by migrating or deleting. 5. Section 5 (Swift
contracts). 6. Knip report, confirm, delete. 7. Delete the old files in the ledger (swap plan section 9: `ui/button.tsx`,
`ui/ui.css`, `ui/join.ts`, button parts of `ui/tokens.css`, the old button tests, `popover.tsx`, remaining `pn-*`/`ov-*`
button families), update `ui/index.ts`. 8. Wire the audit into `pnpm verify` as a test so it can never regress. 9.
`pnpm docs:arch` and regenerate `bionic/code/` (`bionic-regeneration`), `docs:arch:check` exits 0, update
`bionic/research/references/ui-components.md`, journal with `log-work`. 10. Full `pnpm verify` on the final tree.
Done = audit count report all zero (except the allow-list), Knip report clean or justified, verify green.

## 5. The Swift <-> web boundary (found by scanning `apps/studio-shell`; this is a real dependency)

Swift never references React components, but it DOES reference the page by string. Found today:
- `WindowDrag.swift`: injected probe script (`WindowDrag.probeScript`) uses `document.elementFromPoint`, the
  `data-hit-surfaces` attribute (written by the page from `HIT_SELECTORS`), `[disabled],[aria-disabled=true],[data-no-drag]`,
  a `controls` list, `chrome = ".pn-pill,.pn-single-foot"` (what always drags: the toolbar and footer), `pressable`, and
  `typing = "...,.pn-log,.pn-interim,.pn-analysis-text,.pn-codecard,.pn-strip-main,.pn-strip-sub,.pn-note"`, plus
  `document.querySelector('[data-glass="clear"]')`. **The rework already deleted `.pn-analysis-text` and `.pn-codecard`
  (tracks C2 and C3) and changes `.pn-pill`/`.pn-single-foot` (tracks B and A): left alone, window dragging from the toolbar and
  footer and the text cursor over answers and code would silently break.** The file itself says its list must match
  `panels.css` (user-select and text cursor).
- `HostBridge.swift` / `BridgeHandler.swift`: `webkit.messageHandlers.studioHost`, the `HostBridgeScript.emit*` events
  (presentation, account state, screen-watch status, commands) and their page-side listeners; `StudioWebFetch.swift`
  (`callAsyncJavaScript`); `StudioPanel.swift` (probe calls).
Decision (owner, chosen approach): extend the pattern the page already uses for hit regions. `hit-regions.ts` writes
`data-hit-surfaces` on `document.documentElement` (built from the page's own `HIT_SELECTORS`) and the Swift probe reads
it. The page ALSO publishes two more attributes from the same module, e.g. `data-drag-chrome` (what always drags: toolbar
and footer) and `data-text-surfaces` (what the person reads and copies: transcript, answers, code, fields), built from
app-owned `data-` hooks on the swapped components (not library class names), and `WindowDrag.probeScript` reads them,
falling back to today's lists when an older page does not publish them. One source of truth in TypeScript, no hard-coded
class names in Swift, no parity test needed. This is done at the END, after tracks B and C1 have settled the DOM.
Actions: (a) inventory every other string contract (`evaluateJavaScript`, `callAsyncJavaScript`, `WKScriptMessageHandler`,
`messageHandlers`, `querySelector`, `getElementById`, `dispatchEvent`/`CustomEvent`, event and handler names, IDs, data
attributes, localStorage keys) and pair each with its TypeScript side in the manifest `bridgeContracts`; (b) implement the
decision above: add the two attributes and their `data-` hooks on the page side, change `WindowDrag.swift` to read them,
keep `panels.css` (user-select and text cursor) driven by the same hooks, change the matching Swift tests, and run
`node scripts/verify-native.mjs` (build, the 165 + 67 harness tests, swift-format and SwiftLint, the coverage gate);
add a small TypeScript test that the published lists are non-empty and each selector matches a rendered element in the swapped
toolbar, footer, transcript, answer and code; (c) Swift dead code: Periphery (`periphery scan` on the SwiftPM packages)
for unused types and functions. It needs a toolchain that can index the build; on this Command-Line-Tools-only machine
(Xcode licence unaccepted) it may not run: try it, and if it cannot, record it as an owner step instead of claiming it ran.

## 6. Decision (owner): delete Picture-in-Picture and the in-tab overlay card

The Document Picture-in-Picture float and the in-tab overlay card (the whole web overlay surface and its `ov-*` styles)
are to be deleted; the native app is the live-session experience. Consequences: (1) ADR-0017 ("host the active session
overlay as one route") names the PiP window and the in-tab card as hosts of the overlay route, so removal needs a NEW ADR
that amends it (`propose-adr`, left Proposed for the owner to accept; the repo's rules do not allow auto-accepting);
(2) the AUDIT job's file-by-file reachability table (which overlay files the native path or shared code still import: e.g.
`use-hands-free`, `mask-editor`, the screenshots viewer/tray, the session store and engine) decides exactly what is deleted
and what stays; (3) the matching tests (`focus-float.test.tsx`, `overlay-*.test.*`, `host-surface.test.ts`, the web e2e spec
`session-lifecycle-web.spec.ts`) are deleted or rewritten to the native surface; (4) the raw-primitive audit's overlay
allow-list disappears with the files; (5) docs are regenerated (`docs:arch`, `bionic/code`). Order: merge DRAG, AUDIT and E2E,
then run the removal as its own job from the reachability table, then the final full gate.
