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
