# Native app rework in two hours: execution plan (parallel tracks)

Companion to `native-ui-swap-plan.md` (the contract). That file says WHAT: the two rules (old UI goes, behaviour stays), the
behaviour contract (section 4), the T/M/F traceability (4A), the old-to-new map (5), the new data (7), the deletion ledger (9).
This file says HOW, in wall-clock minutes, with who owns which files. Do not restate the contract here; link to it.

The design target is the committed gallery: `design/Native-Panel-Cleanup.dc.html` and `board-1a/1c/1d/1e.png`. Visual sign-off
is a side-by-side with the boards, as the library showcase was reviewed.

## 0. What "done in 2 hours" means (and what it does not)

Done = on branch `native-swap` (off `master`), all old UI replaced by `@oc-tech/omni-ui-components`, every behaviour test
green, the deletion ledger executed with guard tests, `pnpm lint && pnpm format && pnpm typecheck && pnpm test:no-docker &&
pnpm build` green, the browser checks at 900 and 1180 px green, and a board-vs-render comparison attached per track.

Not inside the two hours, and not claimable by an AI session: the macOS-only half (WKWebView hit regions with portalled menus,
cursors, drag, see-through at 100/60/22, ScreenCaptureKit, `swift run studio-shell-tests` after any Swift edit). Those are the
owner's manual QA checklist (swap plan section 8), run on the built app after the merge. The plan reserves 10 minutes at the
end for the owner to start that, not to finish it.

## 1. Preconditions (check at minute 0; each is a blocker, none is optional)

1. The library is consumable: `@oc-tech/omni-ui-components@0.1.0` published (`pnpm publish:package`, owner), or, until then, a
   tarball built from `lib-completion` (`pnpm pack` in `packages/core`) installed with a `file:` dependency. The track code
   must not care which; only `package.json` changes when the published version lands.
2. Docker is running (the full test and e2e projects need it). Without it, workers use the `no-docker` projects and the final
   gate is incomplete: say so in the PR instead of calling it green.
3. The app tooling branches (`chore/biome-hooks`, `chore/swift-tooling-v2`) are merged or explicitly deferred. They touch
   `biome.json`, `lefthook.yml`, `scripts/` and Swift formatting only; they must land BEFORE the rework starts or AFTER it ends,
   never in the middle (a repo-wide Swift reformat plus 10 branches is a merge storm).
4. The machine is quiet enough: this plan runs up to 8 workers at once on a 16-core Mac. Workers run targeted tests; only the
   orchestrator runs the full gate. A worker that finds the machine thrashing reports it instead of retrying blindly.
5. `master` is clean and `native-swap` is created from it by the orchestrator (not by a worker).

## 2. Branching and merging

- Integration branch `native-swap`. Every track works in its own worktree (`../wt-ns-<track>`) on `ns/<track>` created from
  `native-swap` at the moment its dependencies are merged, and pushes its branch; it does not open a PR and never touches
  `native-swap` or `master`. Installs use `LEFTHOOK=0 pnpm install` (worktrees share `.git/hooks`).
- The orchestrator merges one track at a time into `native-swap`, runs the gate subset that track needs, and pushes. Conflicts
  in shared files keep both sides (list in section 4).
- The final PR `native-swap` -> `master` is opened by the orchestrator and merged by the owner after the manual QA starts.
- Commits end with the Claude trailer; pushes use the repo hook (`pnpm verify`); if the hook cannot run for a stated
  environment reason (no Docker) the push is `LEFTHOOK=0 git push` and the report says so. Never `--no-verify`.

## 3. Timeline (T = minutes from the start; the critical path is T0 -> B -> merge -> delete)

| T | Step | Who | Output |
|---|---|---|---|
| 0-20 | **T0 Foundation** (sequential, everything depends on it) | orchestrator + 1 worker | library installed; `ui/theme.css` adapter mapping `--oui-*` per surface (overlay, native panels, Studio, start panel) incl. `--oui-panel-see-through`; `styles.css` mounted first in `studio/tokens.css`; portal host container and `data-oui-surface` added to `HIT_SELECTORS`/`useHitRegions`; zero-pixel diff of pages that render no library component; one `Panel` and one `SplitButton` render in the real overlay page. |
| 0-20 (parallel) | **G Contract tests first** | worker G | the missing behaviour tests written against the OLD UI by role/title/`data-slot` (not `.pn-*`): hit regions with portals, footer states, toolbar states, paused locks, mic and screen badges, answer-style menu, shortcut glyphs from `COMMAND_KEYS`, copy and `edited`. They must pass on the old UI before any swap. |
| 0-20 (parallel) | **F New data contracts** | worker F | section 7 of the swap plan: mic devices and status (`lost`/`retrying`, attempt, Retry now), persistent screen-problem state with fix actions, build tag (`short sha`, branch, `isPackaged`), grouped answer styles and shortcut groups as pure data, answer-header meta and capture event chips. Pure data and tests; no UI. |
| 20-80 (parallel, after T0 merges; B1 also after F) | **Tracks A-E** (section 4) | up to 8 workers | each track replaces its surface, updates its selectors, passes G's tests, attaches a board comparison. |
| 80-100 | **Merge and integrate** | orchestrator | tracks merged one at a time; the full gate on `native-swap`; Playwright at 900 and 1180 px and transcript 330/300. |
| 100-115 | **Delete (Phase 7)** | 2 workers (CSS, TSX) + orchestrator | deletion ledger (swap plan section 9) executed; guard tests added; `pnpm docs:arch` and `bionic/code` regenerated; `docs:arch:check` exits 0. |
| 115-120 | **Hand-off** | orchestrator | PR opened with the board comparisons, the deletion ledger result, the owner's manual QA checklist, and an honest list of what is unverified. |

If a track is not green by T = 80 it is cut from the merge, and the old component for that surface stays until the next cycle
(the rework is allowed to land partially; it is not allowed to land broken).

## 4. Tracks, requirements and file ownership

Requirement ids are the T/M/F items in the swap plan 4A; the track must make each of its ids pass its acceptance check.

| Track | Replaces | Requirements | Owns (files) | Depends on |
|---|---|---|---|---|
| **A Footer and ended/mini** | `status-strip.tsx`, `strip-model.ts` view, `overlay/overlay-footer.tsx`, `ended-card.tsx`, `mini-player.tsx` -> `SessionBar` + `StatusClock`, `Panel`, `Button` | F1-F6 | those files, `panels/footer*.test.*` | T0, G |
| **B1 Toolbar: capture, mic, screen problems** | capture split, mic split, analysing ring, badges -> `SplitButton`, `IconButton` | T1-T4 and the T8 paused locks for these controls | `panels/toolbar.tsx` (capture and mic parts), new `toolbar-capture.tsx`, `toolbar-mic.tsx` | T0, F, G |
| **B2 Toolbar: menus, panes, window** | answer-style menu, shortcuts menu, panel toggles (one segmented group), see-through, window dots restyle, mode menu -> `ActionMenu`, `Segmented`, `Divider`, `Toolbar` | T5-T7, T9, M10 | `toolbar.tsx` (menu and pane parts; B1 and B2 split the file into `toolbar-*.tsx` at T+20 so they do not collide), `window-dots.tsx` | T0, G |
| **C1 Transcript and composer** | chat bubbles/input in `panel-views.tsx` -> `Panel` + `Transcript` (entries mode) + `Composer`/`Input` | M1, M2, M8, M9, M10 | `panel-views.tsx`, chat parts of `panels.css` (not deleted yet) | T0, F, G |
| **C2 Answer pane and dock** | `answer-pane.tsx`, step list, "To apply" tray -> `Panel` (header 40, body, dock), `Steps`, `Markdown`, `Tag`, `Button` | M3-M7 | `answer-pane.tsx`, `answer-*.test.*` | T0, G |
| **C3 Code card** | chrome of `code-card.tsx`, `read-only-code.tsx`, `tests-drawer.tsx` -> `Panel`, `Segmented`, `Button`, `Empty` (CodeMirror stays app-side) | M7, M11 | those files | T0, G |
| **D Start panel and popovers** | `start-panel.tsx` (866 lines) + `start-panel.css`, `popover.tsx`, `settings-popover.tsx`, `source-popover.tsx`, `session-switcher.tsx`, `screen-picker.tsx` -> `Panel`, `Button`, `Segmented`, `Empty`, `Input`, `Tag`, `Popover`, `ActionMenu`, `SettingsDialog` | start panel, popovers (swap plan 5) | those files, `start-model.ts` untouched | T0, G |
| **E Studio web pages** | 89 `<Button` usages in 31 files importing `ui/button` -> library `Button` (mapping in swap plan 5) | Phase 6 | the 31 files only; mechanical | T0 |

Shared files, one owner each: `studio/tokens.css` and `ui/theme.css` (T0 only; tracks ask T0's owner for a mapping instead of
editing), `toolbar-config.ts` (F only, data), `panels.css` and `overlay.css` (nobody edits them during the tracks: tracks stop
referencing classes; deletion removes the rules at T = 100). Anything else shared: keep both sides on conflict.

## 5. Per-track brief (what each worker is told; self-sufficient)

Every worker gets, verbatim: the two rules (swap plan section 0); the behaviour contract rows for its surface (section 4); the
requirement ids and acceptance checks (4A); the old-to-new map rows (5); the board image(s) for its surface; the file ownership
above; the library usage notes (props only, icons as ReactNode, `labels`, callbacks receive the full item, `container` prop for
portals, `data-oui-surface`, tokens `--oui-*`, no `Assistant`); and the machine and git rules (section 2). Each worker must:
1. read the old component and write down its behaviours BEFORE changing it, and confirm G's tests cover them (add the missing);
2. swap to library components, keep the model/behaviour files, update selectors to roles/titles/`data-slot`, never loosen an
   assertion;
3. render the surface in the web build at 900 and 1180 px, dark and light, 0 console errors, and compare to the board;
4. report: files changed, tests (counts), what was driven by hand, differences from the board with requirement ids, anything
   not verifiable off-macOS (hit regions, cursors, drag), and what it could not finish.

## 6. Risks that can blow the two hours (and the cut line)

1. **CSS bleed** from the library into app pages: caught by the T0 zero-pixel diff; if it fails, stop everything and fix T0.
2. **Portals vs hit regions** (menus unclickable in the native window): the `container` prop and `data-oui-surface` are wired
   at T0; only the owner can verify in the shell. Flag every menu in the PR.
3. **See-through**: backgrounds only; text and icons stay opaque (library contract). Verify at 22% in the web build.
4. **Toolbar collision** (B1 and B2 on one file): split into `toolbar-*.tsx` at T+20 before either track writes.
5. **Missing library API** discovered mid-track: the worker records it and uses an app-owned wrapper (window dots, CodeMirror
   canvas, mask editor stay app code with library tokens and `Button`/`IconButton`); library changes go to a follow-up, never
   into this branch.
6. **Machine load** (8 workers): targeted tests only; the orchestrator runs the full gate; no worker starts Storybook unless it
   needs it.
7. **Deletion before green**: nothing in the ledger is deleted until its replacement passes G's tests; the guard tests (swap
   plan 9) fail the build if an old import or CSS family returns.

## 7. Orchestrator checklist at each merge

1. `git merge --no-ff ns/<track>` into `native-swap`; keep both sides on shared-file conflicts.
2. `pnpm lint && pnpm format && pnpm typecheck && pnpm test:no-docker` (plus the track's browser check).
3. Open the board and the render side by side for the track's surface; reject a merge that differs without a reason.
4. Push `native-swap`; record the track's unverified items in the PR description as they arrive.
