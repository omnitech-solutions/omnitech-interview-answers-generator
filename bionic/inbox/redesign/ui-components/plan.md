# One component per job: UI component consolidation (plan and todos)

Status: PHASE 1 (audit) dispatched 2026-10-06. Owner: the orchestrating session. Nothing is built until the audits are read and the plan below is revised from them.

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
- [ ] A: web buttons audit report
- [ ] B: web primitives audit report
- [ ] C: native audit report
- [ ] D: reference and fit report
- [ ] Orchestrator: read all four, spot-check claims against the code
- [ ] Orchestrator: decide location and API; ADR if needed; revise this plan
- [ ] Orchestrator: write the Phase 3 worker briefs (one per slice, with the constraints above)
- [ ] Slice 1: component + tokens + page
- [ ] Slice 2: Resume family and live chrome
- [ ] Slice 3: remaining live/overlay UI
- [ ] Slice 4: rehearsal, documents, knowledge, settings, start
- [ ] Slice 5: native wrappers
- [ ] Each slice: orchestrator reviews the diff and runs `pnpm verify` before committing
- [ ] Regenerate `bionic/arch` (`pnpm docs:arch`) and journal the work (`log-work`)
- [ ] Rebuild Docker web + reinstall the native app; check on the real app

## Log
- 2026-10-06: plan written; audits dispatched.
