# One component per job: UI component consolidation (plan and todos)

Status: PHASE 1 (audits) DONE 2026-10-06; PHASE 2 (decisions) DONE below; PHASE 3 (implementation) in progress. Owner: the orchestrating session.

## Why
The owner found three different "resume" buttons (the web banner, the session bar, the native strip and footer) drawn by three different classes (`ov-button go`, `pn-mini-button`, `pn-bar-button`), and asked for ONE button component that is data/config driven (variant, size, state, icon, loading) and used by web and native alike, organised like `omni-ui-components/packages/core/src/components/ui` (one file per primitive; shadcn style: `cva` variants + sizes, `asChild`, `forwardRef`, `cn()`).

## Constraints (from AGENTS.md, ADR-0002/0003/0004: do not break)
- Simplicity first: no speculative layers. A shared component is justified here because there are many real second implementations.
- Each package has one responsibility and one public entrypoint per runtime surface; never import another package's internal files. Products never import `apps/web`; domain code never imports Next.js.
- Any new package or a change to package boundaries needs a proposed ADR (`propose-adr`), not a silent move.
- Never hand-edit `bionic/arch/` or `bionic/code/` (regenerate: `pnpm docs:arch`).
- Verify with `pnpm verify` before claiming completion; commit only when green; push to master (the owner's standing instruction).
- The native shell's drag/cursor/hit-region rules key off class names (`.pn-pill`, `.pn-single-foot`, `HIT_SELECTORS`, `WindowDrag.typing`). Renaming a class is a behaviour change: it must keep those lists in step (tests in `hit-regions`, `WindowDragTests`, `glass-guard`).

## Phase 1: audits (read-only; each worker writes ONE report file in this folder)
| Worker | Scope | Report |
|---|---|---|
| A. Web buttons | every button-like element in `products/*/src/frontend`, `apps/web`, `packages/*` with React: `<button>`, `role="button"`, `<a>` styled as a button, every CSS class that styles one, variants/sizes/states in use | `audit-web-buttons.md` |
| B. Other web primitives | inputs, selects, popovers/menus, chips/pills/badges, cards, tabs/toggles, toasts/banners/strips, icon-only controls, tooltips; and what shared component code already exists (where, how used) | `audit-web-primitives.md` |
| C. Native (Swift) | every control, view, cursor, drag/resize helper in `apps/studio-shell`, `apps/capture-companion`: what is custom AppKit/SwiftUI vs web-view content; what wrappers exist; how they are organised | `audit-native.md` |
| D. Reference and fit | read `omni-ui-components/packages/core/src/components/ui/*` (button, badge, toggle, tabs, ...): the conventions to mirror; then how to fit them to THIS repo (plain CSS tokens `--ov-*`/`--pn-*`, no Tailwind?), where the code should live (new package vs existing), and ADR needs | `audit-reference-fit.md` |

Each report: inventory table (file:line, element, classes/props, variant, size, states, icon use), duplicates and near-duplicates grouped, inconsistencies (label, icon, colour, size, disabled/loading behaviour), a proposed variant/size/state vocabulary, risks (tests, CSS guards, native hit-region/drag lists), and a ranked migration order. Max about 1500 words plus tables. Facts only, with file:line; no code changes.

## Phase 2: design (orchestrator)
Read the four reports, decide: location, API (`variant`: primary | secondary | destructive | outline | ghost | link | go ...; `size`; `icon`/`iconPosition`; `loading`; `asChild`), token mapping, migration order, native wrapper shape. Propose an ADR if a package/boundary changes. Revise this plan.

## Phase 3: implementation workers (written after Phase 2; one per slice, each verified before commit)
Slice order (draft): 1) the component + tokens + docs/story page; 2) the live panel/footer/strip/banners/session bar (the "Resume" family); 3) the rest of the live and overlay UI; 4) rehearsal, documents, knowledge, settings, start; 5) native Swift wrapper(s) and any AppKit controls. Each slice: tests first or kept green, `pnpm verify` green, no behaviour change except the intended unification, class lists in hit-regions/WindowDrag updated, a short note of what moved.

## Todos
- [x] A: web buttons audit report
- [x] B: web primitives audit report
- [x] C: native audit report
- [x] D: reference and fit report
- [x] Orchestrator: read all four, spot-check claims against the code (419 buttons; .ov-button.go only in panels.css; .studio-button defined twice: confirmed)
- [x] Orchestrator: decide location and API; ADR if needed; revise this plan (no ADR now; see decisions)
- [ ] Orchestrator: write the Phase 3 worker briefs (one per slice, with the constraints above)
- [x] Slice 1: component + tokens + reference doc (committed 5fd4bb9)
- [ ] Slice 2: Resume family and live chrome
- [ ] Slice 3: remaining live/overlay UI
- [~] Slice 4: 74 `.studio-button` sites migrated (home, workspace, rehearsal, briefings, live setup/ended, account); Documents (`dx-button`, 22 sites), session-bar and end-confirm and the other families remain: see slice4-remaining.md
- [ ] Slice 5: native wrappers
- [ ] Each slice: orchestrator reviews the diff and runs `pnpm verify` before committing
- [ ] Regenerate `bionic/arch` (`pnpm docs:arch`) and journal the work (`log-work`)
- [ ] Rebuild Docker web + reinstall the native app; check on the real app

## Log
- 2026-10-06: plan written; audits dispatched.

## Phase 2 decisions (2026-10-06)
Evidence: audit-web-buttons.md (419 `<button>`, 14+ class families, Resume drawn 7 ways, `.studio-button` defined twice with opposite defaults, heights 20-42px, radii 5-999px, three or four token systems and hundreds of hard-coded colours), audit-web-primitives.md (shared UI nearly absent: Icon, Dialog, Popover only), audit-native.md (native surface is tiny: no SwiftUI, no NSButton; every panel body is web content), audit-reference-fit.md (no Tailwind/cva/Radix here; recommends a product-internal ui folder).

1. **Home**: `products/interview/src/frontend/ui/`, one file per primitive, `index.ts` the only import path. No new package, no ADR, no new dependency now (ADR-0002/0003: no boundary is crossed). Promote to `packages/ui` with an ADR when Presentation (its own product, 62 buttons) adopts it; everything imports from one `index.ts`, so that move is mechanical.
2. **Design tokens are mandatory (owner, 2026-10-06)**: no component and no migrated rule may hard-code a colour, radius, height, spacing or opacity. One semantic token layer `ui/tokens.css` (`--ui-*`: colour roles per intent, radii, control heights, spacing, focus ring, disabled opacity, motion), with per-surface scopes (Studio, overlay `.ov-root`, native panels `.pn-root`, clear glass) that map the `--ui-*` roles onto the existing `--ov-*`/`--pn-*`/Studio values. Components read only `--ui-*`. Each migration slice also replaces hard-coded colour literals in the rules it touches with tokens.
3. **API (mirrors the reference, adapted to plain CSS)**: `Button` with `variant` (primary | secondary | ghost | destructive | go | link | glass), `size` (sm | md | lg | icon), `icon` / `iconAfter` (Icon name), `loading`, `pressed`, `asChild`, `type="button"` default, `forwardRef`, `displayName`, defaults as default parameters; emits `data-slot="button"`, `data-variant`, `data-size`, `data-state` (idle|loading|pressed), `aria-busy`; disabled and loading use the native `disabled` attribute (the native shell's drag/cursor probe relies on `disabled`/`aria-disabled`). A typed config table (`Record<Variant, ...>` and a documented vocabulary) is the single place variants are defined; CSS selects on the data attributes. No cva needed (no dependency); `cn` replaced by a 3-line `join`.
4. **Chip/Badge, Switch, Spinner, Banner, Tabs/ToggleGroup, Menu, Field/Input/Select, Card, Dialog/Toast/EmptyState** follow as later slices in the priority order of audit B, each one file in the same folder, same data-attribute convention, same tokens.
5. **Native (Swift)**: no components layer (the native surface is windows, drag/resize handles, a status item, menus and two NSAlerts; nothing is a button the app styles). Slice 5 becomes: keep `HIT_SELECTORS`, `WindowDrag.swift` and their tests in step with the new `data-slot` markup; optional hygiene (delete the dead `ToolbarDragView`, drop the unused grip drawing, split `NativeSurface.swift` by type). A Swift wrapper layer is built only if a second native button ever appears.
6. **Hard constraints for every slice**: a Button renders `<button>` (or `<a href>` via `asChild`), never a div; labels stay (tests use `getByRole("button", {name})`); legacy container classes stay (`.pn-pill`, `.pn-single-foot`, `.pn-strip`...); `layout-rules.test.ts` (40px hit area for live buttons) and `session-bar.test.tsx:644` (`.live-bar-button` min-height 40) keep passing; `glass-guard.test.ts` allow-list is updated with the migrated selectors; the scope checkpoint (1000 lines) applies per slice, so split per surface.

## Phase 3 slices and briefs
- **Slice 1 (worker 1)**: `ui/` skeleton: `join.ts`, `tokens.css`, `button.tsx`, `ui.css`, `index.ts`, `button.test.tsx` (variant x size x state matrix, roles, default type, loading, asChild, icon slots, token-only CSS assertion), a vocabulary reference at `bionic/research/references/ui-components.md`. NO consumers migrated.
- **Slice 2 (worker 2)**: the Resume/Pause/End/Start family across the live panel strip and footer, the overlay card, the session bar and the banners; unify wording ("Resume session"), play icon, one look.
- **Slice 3 (worker 3)**: the remaining live/overlay/panel buttons (`pn-bar-button`, `pn-mini-button`, `pn-primary`, `ov-button`, `ov-link`, task chips, file tabs where they are buttons).
- **Slice 4 (worker 4)**: `.studio-button` consumers (home, workspace, rehearsal, documents, knowledge, settings, start) and the duplicate definition removed.
- **Slice 5**: native upkeep as in decision 5.
- **Slices 6+**: Chip/Badge, Switch, Spinner, Banner, Tabs/ToggleGroup, Menu, Field, Card, Dialog, one primitive per worker, each with its migrations.
Each worker: reads this plan and the four audits first; works only in its slice's files; does NOT commit or push; runs the narrow tests, then reports the file list, what moved and anything it could not do. The orchestrator reviews the whole diff, runs `pnpm verify`, checks the real app where visible, and commits.

## Log
- 2026-10-06: audits done; decisions written; Slice 1 dispatched.
- 2026-10-06: Slice 1 reviewed and committed. Slice 4 (first part) reviewed, verified (5531 tests) and checked in a real browser. The browser check found what tests could not: surface resets such as `.studio-frame :is(button, input) { color: inherit }` out-specified the Button's single-attribute base rule, so the primary button inherited light text on the accent fill (about 2.4:1). Fixed by giving the base rule two attribute selectors (`[data-slot="button"][data-variant]`) plus a regression test. LESSON FOR EVERY SLICE: after a migration, read the computed colours of one button per variant in the browser (`e2e/live-session/.audit/colors.mts`), not only the tests.
- 2026-10-06: Slice 2 (Resume/Pause/End/Start family, footer, strip) is ON HOLD until the owner's Claude Design footer is final; Slice 3 is blocked on the same design (panels). Presentation product adoption needs an ADR (`packages/ui`) and is the owner's call.


---

# Native App components: the merged gap list and todos (2026-10-06)

Inputs: `native-panel-cleanup-brief.md` (the owner's T1-F6 brief and component direction), `gap-toolbar.md` (Worker E), `gap-panels-footer.md` (Worker F). Both reports were read and key claims spot-checked against the library and this repo (Button has no loading/pressed and its `asChild` is declared but unused; `Empty` is a dashed box with no tile; `IconButton` has no badge/tone/pressed; the footer tint is `panels.css:588`; the recording system line is `use-panel-session.ts:103`).

## Direction (supersedes Phase 2 decision 1, pending the owner's confirmation)
- Native and Storybook use the SAME components. The home is the library `~/dev/omnitech-solutions/omni-ui-components` (`packages/core/src/<Component>/`), each with types, variants, stories, factories, and a row in the Component Overview. A new **Native App** showcase reproduces the designer gallery.
- `products/interview/src/frontend/ui/` (Slice 1) becomes a thin adapter: one import path for products, repo defaults, and the token mapping (`--oui-*` from `--ui-*`/`--pn-*`/`--ov-*` per surface). Its own `Button` is retired once the library Button covers `go`, `glass`, `loading`, `pressed`.
- Nothing is a "native component". Native-only code stays only where it is genuinely custom.

## The list: what is missing in the library
| # | Item | Kind | Used by | Config-driven shape (callbacks and placement included) |
|---|---|---|---|---|
| 1 | Tokens: control heights (36 / 52 labelled), tone scale (neutral, accent/blue, success, warning/amber, danger/red, dim), panel (header 40, dock, scroll-fade 28), see-through (background opacity only), footer, clock | TOKENS | all | CSS variables in `styles/tokens.css`; surfaces map them |
| 2 | **Button**: `tone`, control size, `shortcut`, `loading`, `pressed`, `soft` (outlined), `fillIcon`, `labelMaxWidth`, `tooltip`, working `asChild` | VARIATION | T5, T9, M3, M6, M8, M9, F3, F4, empty-state action | `tone`, `size`, `onClick`, `shortcut: string[]`, `fillIcon` |
| 3 | **IconButton**: `tone`, `pressed`, `badge`, `caption`, `tooltip`, `disabledReason` (aria-disabled so a tooltip can still show), control sizes | VARIATION | T1-T4, T7, T8, T9, M1 copy, M8 | `badge: { tone, label }`, `onClick`, `disabledReason` |
| 4 | **Progress** `shape="ring"` | VARIATION | T2 | `value` or indeterminate, `tone` |
| 5 | **Segmented** `mode="multiple"`, control appearance, icon options, "last active can't be turned off" | VARIATION | T6 | `options[{value, icon, label, disabledReason}]`, `value`, `onChange`, `minActive` |
| 6 | **Empty** tile variant (40 px icon tile, optional title, one line, optional action) | VARIATION | M7 (x3 panels) | `icon`, `title`, `description`, `action: { label, onClick }` |
| 7 | **Steps** checklist variant (done check / current ring / pending circle) | VARIATION | M3 | `items[{label, state}]` |
| 8 | **Tag** mono / copy-on-click / tooltip | VARIATION | F2 build tag, event chips | `copyValue`, `tooltip`, `onCopy` |
| 9 | **Divider** as control separator (20 px) | NONE (class + token) | T9 | token only |
| 10 | **Toolbar** container (role=toolbar, control-size context, groups, separators) | NEW (thin) | T1-T9 | `size`, `groups[]`, children |
| 11 | **SplitButton** (main + caret sharing one border, 1 px divider; tone; status badge; ring state) | NEW | T1, T2, T3, T4, T8, T9 | `main: ControlSpec`, `menu: ActionMenuSpec`, `onPress`, `onOpenChange`, `status` |
| 12 | **ActionMenu** over Dropdown: sections, items (check column, sub-label, shortcut keys, destructive, disabled reason), notice row, hint row, `kind: "list"`, viewport max-height | NEW (the only one with real logic) | T1, T3, T4, T5, T7 | `sections[]`, `onSelect`, `notice`, `hint`, `onOpenChange` |
| 13 | **Panel**: 40 px header (title, meta, actions), scrolling body, optional dock, scroll config | NEW | M2, M4-M7, M9, M10 | `title`, `meta`, `actions`, `dock`, `children`, `scroll: { fade, stickToBottom }` |
| 14 | **Transcript**: speech turns, chat messages, one-line event chips, `edited` flag, copy per bubble, fade mask, thin scrollbar, stick-to-bottom, "Jump to latest" | NEW | M1, M2, M9 | `items[]`, `onCopy`, `onSelect`, `onJump` |
| 15 | **SessionBar + StatusClock**: record icon + monospace timer, paused state, dev build tag, Pause/Resume, outlined End with confirm | NEW | F1-F6 | `status`, `elapsed`, `buildTag`, `onPauseResume`, `onEnd` |
| 16 | **Composer** (input + neutral mic + muted send) | NEW or FOLD into `Input` with a trailing `actions` slot: recommend FOLD | M8 | `value`, `onChange`, `onSend`, `onToggleMic`, `dictating` |
| 17 | `useFollowLatest` hook moves into the library unchanged | HOOK | M9 | |
| - | WindowDots (traffic lights tied to the Swift shell), the `.pn-pill` frame, `ToolbarLock` (maps to `disabledReason`), the code editor body, the tests drawer, the screenshots tray content (renders into `Panel.dock`) | CUSTOM, stays in this repo | | |

**Net:** 5 genuinely new components (Toolbar, SplitButton, ActionMenu, Panel, Transcript) plus SessionBar, with Composer folded into Input = 6; 7 variations; 1 token set; 1 hook. Everything else is configuration.

## Needs from the app (data that does not exist today)
Mic device list, "attempt n" and a Retry action (T3); skill groups and shortcut groups in the contracts (T5, T7); a persistent "screen problem" state: permission lost, display disconnected, last capture failed (T4; today toasts only); build tag data: full SHA, branch and an isPackaged signal (F2; `BUILD_ID` is a short SHA only); panel widths 330/300 (today hard-coded 320/480/420).

## Todos
### Phase L: library (omni-ui-components). Each slice: types, variants, story, factory, test, a Component Overview row, library `pnpm verify`
- [ ] L0 Spike (before anything): consume the library from this repo; confirm Tailwind `@layer` order vs `panels.css`, no preflight reset leaks, React peer range, bundle size in the web view, Radix portals vs native hit regions
- [ ] L1 Tokens (item 1) and the Button + IconButton variations (items 2, 3), `asChild` fixed
- [ ] L2 Progress ring, Segmented, Empty tile, Steps checklist, Tag (items 4-8), Divider token (9)
- [ ] L3 Toolbar, SplitButton, ActionMenu (items 10-12)
- [ ] L4 Panel and `useFollowLatest` (items 13, 17)
- [ ] L5 Transcript, and Composer as an `Input` actions slot (items 14, 16)
- [ ] L6 SessionBar + StatusClock (item 15)
- [ ] L7 Native App showcase (below), Component Overview rows for every new component and variation, Table Overview untouched
- [ ] L8 Publish (npm `@oc-tech` publish and re-vendor, or `link:` while developing)
### Phase A: this repo adopts (after L0; footer first because it closes the held Slice 2)
- [ ] A1 Dependency + adapter: `ui/index.ts` re-exports library components with repo defaults, `ui/tokens.css` maps `--oui-*`; products import only `../ui`
- [ ] A2 Footer F1-F6: replaces the amber tint and the "Paused" notice I built (F6: the footer never tints; F3: no paused banner); updates tests that assert the removed items
- [ ] A3 Toolbar T1-T9: merged capture control, ring, mic and screen badges, answer-style menu, segmented toggles, shortcuts menu, paused state, size system; `HIT_SELECTORS`/`WindowDrag` updated for portals; amend the 40 px hit-area rule for the toolbar
- [ ] A4 Answer and Code panels M3-M7, M10-M11 (reflow 330/300, see-through on backgrounds only)
- [ ] A5 Transcript and composer M1, M2, M8, M9 (no recording line, no header dot)
- [ ] A6 Retire `ui/button.tsx` and the leftover `.studio-button`, `pn-*`/`ov-*` button families, other families from `slice4-remaining.md`
- [ ] Each slice: orchestrator reviews the full diff, `pnpm verify`, reads computed colours in the browser, regenerates `bionic/arch`, then reinstalls the native app and checks it on screen

## Native App showcase (matches the designer gallery)
`packages/core/src/Showcase/NativeApp/` with `NativeApp.stories.tsx`, `NativeApp.fixtures.ts` (pure config objects and a shared `handlers` object of Storybook actions) and a shell; Storybook title `omni-ui-components/Showcase/Native App`, sorted after Getting Started. One story per gallery board, each composing ONLY library components from config: Toolbar (compact, labelled-mode variants not used, capture/mic/answer-style/shortcuts menus, paused), Panels (ready, analysing, answer ready with code hidden), Footer (live dev, live production, paused dev). Controls: `seeThrough` (100/60/22), `width` (900/1180), `paused`, `devBuild`. The Zoom-style board 1b is excluded.

## Decisions needed from the owner (my recommendation first)
1. Library is the single home, `ui/` becomes an adapter, our `ui/Button` retires. Recommend YES (supersedes Phase 2 decision 1).
2. Publish path: `link:` while developing, npm publish + re-vendor once stable. Recommend YES.
3. Fold Composer into `Input` (6 new components, not 7). Recommend YES.
4. Rename `buttonSize` to `size` in the library (breaking, pre-1.0) or keep an adapter translation. Recommend RENAME.
5. Icons: components take caller-supplied icon nodes (this app passes its Material Symbols `Icon`; stories use a small Material helper). Recommend YES.
6. New app data (mic devices and retry, skill and shortcut groups in the contracts, persistent screen-problem state, build tag data): build them in Phase A, or ship the UI with those parts optional first. Recommend UI first, data behind it.
7. Paused behaviour: panel toggles stay usable (the brief says so; today they are disabled, and I disabled them this session) and the capture caret menu still opens while paused. Recommend FOLLOW THE BRIEF.
8. Amend the 40 px hit-area rule for the 36 px toolbar. Recommend YES.
9. Accept a portal marker in the native hit-region selector table (shell contract change) for Radix menus and tooltips. Recommend YES.
10. Drop gallery board 1f (footer with sensor icons). Recommend DROP.
