# Native app UI swap: replace the old UI with `@oc-tech/omni-ui-components` (brief for a Crux dev cycle)

Written 2026-10-06. Run it as an **architectural-tier** `dev-cycle` (it adds a dependency, changes the UI foundation and
exceeds 1,000 changed lines, so AGENTS.md demands a scope checkpoint and an ADR). Read `bionic/objectives.md` and
`bionic/AGENTS.md` first and carry them into every delegation. The companion brief for the library side is in the library
repo: `omni-ui-components/bionic/inbox/lib-completion-plan.md`. Its P0 items gate this work.

## 0. The two rules that matter most

1. **The old UI components go.** Every hand-written panel, button, menu, strip and stylesheet family that the library now
   covers is deleted, not left beside the new one, and a guard test makes sure it cannot come back (section 9).
2. **Behaviour stays exactly as it is.** This is a swap of the view layer. No flow, state machine, shortcut, timing,
   privacy rule or native-shell contract changes. The behaviour contract is in section 4; every item names the test that
   pins it, and any item without a test gets one **before** its old component is removed.

If a swap seems to need a behaviour change, stop and write it down as a question; do not decide it silently.

## 1. Where the app stands

- Native macOS shell (`apps/studio-shell`, Swift) hosts the web UI in a `WKWebView`. In the native single window the page
  shows the **start panel** when there is no live session, and the **single panel** (toolbar, panes, footer) when there is.
  Panels are web pages served by the Docker web app at `http://127.0.0.1:3000`, so the native app shows whatever the web
  build serves.
- The panel UI lives in `products/interview/src/frontend/studio/live/overlay/panels/` (40 source files, about 7,000 lines of
  TSX/TS) with three stylesheets: `panels.css` (1,890 lines, `pn-*` classes), `start-panel.css` (516 lines) and the older
  `overlay.css` (1,838 lines, `ov-*`), plus `code-canvas.css` (`lc-*`). Studio web pages use a product-internal `Button`
  (`ui/button.tsx`, 31 files, 89 `<Button` usages) and `--ui-*` tokens (`ui/tokens.css`, `ui/ui.css`).
- The earlier decision (`bionic/research/references/ui-components.md`) was "no new package or dependency". The owner
  reversed it: **the library `~/dev/omnitech-solutions/omni-ui-components` is the single home for components.** This work
  supersedes that note; propose an ADR and update the note.
- The designer's target is the gallery `Native Panel Cleanup.dc.html` (boards 1a, 1c, 1d, 1e; ignore Zoom board 1b, drop 1f),
  **committed in this repo** at `bionic/inbox/redesign/ui-components/design/` (the original lives in the owner's Downloads) and its written requirements T1–T9, M1–M11, F1–F6 in
  `bionic/inbox/redesign/ui-components/native-panel-cleanup-brief.md`. The library's showcase
  `omni-ui-components/Showcase/Native App` reproduces those boards from library parts and is the visual reference.

## 2. Prerequisites (check before writing any code)

1. A published library version exists with the work in section 1 of the library plan:
   `npm view @oc-tech/omni-ui-components version` must be `>= 0.1.0` (owner publishes). If it is still `0.0.2`, **stop**: the
   components are not available.
2. Library plan items **P0-2 to P0-6** (entry points, CSS isolation, theme contract, portals, hit area) are done or have an
   accepted workaround written in the ADR. P0-3 (CSS delivery) and P0-5 (portals) are the two that can break the native
   window; do not skip their spike here.
3. The owner can run the native shell on macOS for manual QA (cloud sessions cannot, see section 8).

## 3. Decisions to take in the ADR (propose with `propose-adr`, do not auto-accept)

- Dependency: add `@oc-tech/omni-ui-components` to `products/interview` (scope checkpoint, then
  `scripts/dependency-declarations.test.ts` and `scripts/package-boundaries.test.ts` must be updated deliberately).
- Where the adapter lives: keep `products/interview/src/frontend/ui/` as a **thin adapter only** (token mapping and any
  app-specific wrappers). No component logic is copied from the library.
- Tokens: the app's `--ui-*`, `--pn-*`, `--ov-*` scopes map onto `--oui-*` per surface (section 6, Phase 1).
- Order of CSS: import `@oc-tech/omni-ui-components/styles.css` once, at the top of `studio/tokens.css`, with the library
  layer ordered below app CSS (`@layer omni-ui-components`).
- Hit-area rule: the app requires a 40 px target; library controls are 36 px visuals with a 40 px hit area (library P0-6).
- Strings: all copy that the app owns stays in the app (`labels` props), including wording tests assert on.

## 4. Behaviour contract (must remain; each has a test or gets one first)

Group tests by file under `products/interview/src/frontend/studio/live/overlay/panels/*.test.ts(x)` unless noted.

### 4.1 Window and shell
- The **custom window controls** (quit red ×, hide yellow −, size green +) with their exact `label`/`title` texts
  (`WINDOW_CONTROLS`), the green menu that opens on a 1,000 ms hover with a 300 ms grace (`GREEN_MENU_HOVER_MS`,
  `GREEN_MENU_GRACE_MS`), the three window modes **Normal / Mini player / Full screen** (`WINDOW_MODES`), the mini size
  440×190 with menu height 330 (`MINI_SIZE`), the quit confirmation copy (`QUIT_CONFIRMATION`), and the toast "Paused while
  hidden" (`HIDDEN_TOAST`). (`toolbar-config.test.ts`; `window-mode.ts` has no dedicated test, so add one before touching it.)
- Pane widths: `BARE_WIDTH` 540, `windowWidthFor(PaneState)`, the transcript 330 (min 300), equal share of the rest, the
  footer spanning the full pane row, nothing cropped at widths ≥ 900. (`toolbar-config.test.ts`, `panels.test.tsx`.)
- **The panel is never toolbar-less or a dead end.** In the native single window the start panel shows whenever there is
  no live session; a lost session shows the `GONE_TEXT` banner with a working "Try again"; recovery after a lost session is
  automatic. (`start-panel.test.tsx`, `single-panel.test.tsx`, `signed-out.test.tsx`.)
- **Native hit regions**: draw-only hit testing. The page reports its drawn regions (`useHitRegions`, `data-hit-surfaces`);
  the shell drags from any drawn area, clicks through undrawn areas, shows the correct cursor (pointer on controls, text
  on text, grab on draggable chrome, arrow elsewhere) even when the app is inactive, and has no system window shadow.
  Selecting text works in the transcript, answers and the strip; typing areas are never dragged. (`hit-regions.test.tsx`;
  Swift `HitRegionTests`, `WindowDragTests`, `PresentationTests`.) The probe fails open: a missing attribute must never
  block dragging.

### 4.2 Session lifecycle and the footer
- Pause is a break (session stays open), End finishes it for good with its confirmation, Resume restores. Button wording
  `Pause session` / `Resume session` / `End session` and tones (`footerButtons`, `FooterState`). (`strip-model.test.ts`.)
- **While paused**: the body panels are hidden; capture and microphone controls are locked with the tooltip "Resume to
  capture"; the capture chevron looks disabled; the **Manual/answer-mode menu is never disabled**; pane toggles are disabled;
  the strip shows `PAUSED_NOTICE` once at the footer's left in the warning colour; the timer excludes paused time (server
  `paused_at`/`paused_ms`). (`single-panel.test.tsx`, `panels.test.tsx`; server tests under `products/interview`.)
- Ended view: "Open summary" when a summary exists, "New session", `canSummary`/`starting` states. (`start-panel.test.tsx`,
  `summary-link.test.ts`.)
- Single owner of the session per window; the panel bus and owner arbitration (`panel-owner.ts`, `panel-bus.ts`,
  `stacking.test.ts`, `panel-bus.test.ts`) are untouched.

### 4.3 Listening and the transcript
- Same-speaker phrases merge into one bubble (gap ≤ 1.5 s, open sentence 6 s), flagged `edited` with the updated time.
  (`panel-model.test.ts`.)
- Questions from the microphone are answered when **no interviewer audio** was heard; once an interviewer is detected, the
  user's own speech is ignored. The microphone keeps listening in Manual mode. Interviewer role facts are passed to the
  draft as **untrusted notes**. (Server tests in `products/interview/src/backend/live-session/`.)
- The transcript holds only speech turns, the user's chat messages and one-line **capture event chips** ("S1 · no
  question found · 08:33"). No recording or system status lines are ever written into it (T3/M1). Each bubble has a copy
  control; text is selectable.

### 4.4 Capture, analysis and the answer
- Capture modes **Manual / Auto** with the auto limits (`autoLimits`), the capture trigger, failure and permission states
  (`capture-failure.ts`, `capture-problem.test.tsx`), the display/screen picker (`display-picker-model.ts`,
  `screen-picker.test.tsx`), auto backoff, auto interval and hash gates (all under `overlay/*.ts`, untouched).
- Analysing shows progress in **one place** (the step list in the Answer panel, with a Stop control); no banner and no
  "Capturing the screen…" chat line. "No question found" appears as the Answer header meta and a transcript chip.
  (`no-question.test.tsx`, `engine.test.tsx`.)
- The **To-apply tray** (count, thumbnails, Add screenshot, Clear, Apply) and the apply behaviour; screenshots as private
  artifacts served as downloads only (ADR-0012); mask editor and local preview untouched.
- Revisions, tests drawer, read-only code and the code canvas (CodeMirror, tabs, copy, Run) keep working
  (`revisions.test.tsx`, `tests-drawer.test.tsx`, `code-canvas.test.tsx`, `read-only-code`).

### 4.5 Keyboard and commands (exact bindings; do not adopt the designer's glyphs)
The designer's boards and the library showcase show `⌘⇧S`, `⌥⇧U`, ... as illustrations. **The app's real bindings are the
contract** (`commands.ts` `COMMAND_KEYS`, plus the host's system-wide hotkeys through `nativeChord`):
`Alt+Shift+A` capture & analyse, `Alt+R` microphone, `Alt+Shift+H` auto, `Alt+Shift+S` generate the solution,
`Alt+]` / `Alt+[` next/previous skill, `Alt+Shift+C` clear session memory, `Alt+Shift+F` focus the chat,
`Alt+Shift+I` see-through. Pass them to library components through `shortcut` props (render macOS glyphs
`⌥⇧A` and so on from the real keys; `nativeChord` is the source). Keep each command's one-run-per-physical-press claim and
`FOCUS_INPUT_EVENT`. (`commands.test.ts`.)

### 4.6 Privacy and data rules (AGENTS.md)
Never log questions, prompts, generated content or code, notes, attachments, credentials or model responses. Screenshots
stay private artifacts. Tenant routing (`/t/:tenantSlug/p/:productId/*`) and membership resolve before domain work. No
new network or persistence is introduced by the swap.

### 4.7 Accessibility names
Tests query by role, `title` and visible text (`getByTitle`, `getByRole`). Every `label`/`title` string above must be
preserved exactly, passed through the library's `labels` props. Where the library adds a `tooltip`, the accessible name
must not change.

## 4A. The redesign is the target: every requirement, its phase and its acceptance check

The new native app must **represent the designer's redesign** (`bionic/inbox/redesign/ui-components/design/`: the gallery
file, boards 1a, 1c, 1d, 1e, and a README) and satisfy its written instructions, which are in
`bionic/inbox/redesign/ui-components/native-panel-cleanup-brief.md` verbatim. The brief's own first line is the contract for
this whole swap: *"Keep every behaviour and shortcut exactly as it is; only change layout, visuals and where state is
shown."* Treat each row below as an acceptance criterion; a phase is not done until its rows pass. "Lib" is the library
component that renders it (see the showcase `omni-ui-components/Showcase/Native App`, which already reproduces these boards).

| Id | Requirement (short) | Phase | Lib | Acceptance check |
|---|---|---|---|---|
| T1 | "Manual" pill removed; capture caret menu has "When to analyse" (Manual / Auto, current copy) above "Display"; neutral = Manual, blue tint = Auto; coloured dot removed; tooltip names the mode; click behaviour and the auto key unchanged | 3 | `SplitButton`, `ActionMenu` | Unit: menu sections and order, tint by mode, no dot element, tooltip text. Behaviour tests for mode and click unchanged. |
| T2 | While analysing the icon is a blue progress ring; click or the capture key stops the run; banner deleted | 3 | `SplitButton` (`state="analysing"`), `Progress` | Unit: ring present while a run is active, no banner node; stop path still ends the run (`engine.test.tsx`). |
| T3 | Mic: listening neutral white mic; muted red slashed; lost/retrying amber outline + "!" badge; caret lists devices, status "Trying again · attempt n", "Retry now"; banner removed; `Alt+R` unchanged | 3 | `SplitButton`, `IconButton` badge, `ActionMenu` | Unit per state (colour tone, slash, badge); caret menu content from device data; no banner string anywhere. |
| T4 | Screen problems (permission missing, display gone, last capture failed) get the same amber outline and badge; caret leads with the reason and a fix action | 3 | `SplitButton` status, `ActionMenu` | Unit per problem kind; fix action fires its handler. State persists until resolved (section 7). |
| T5 | Answer style: full name up to 260 px then ellipsis + tooltip; menu sized to the viewport with internal scroll; grouped Technical / Conversation; fixed check column; "⌘↑ ⌘↓" hint row (show the **app's real keys**) | 3 | `ActionMenu`, `Button` | Unit: label width cap, groups, hint from `COMMAND_KEYS`; browser check at a short window that no item is cut off. |
| T6 | Chat / Answer / Code toggles are one bordered segmented control; active = blue tint; the last visible panel cannot be turned off (disabled with a tooltip) | 3 | `Segmented` (`multiple`, `minActive`) | Unit: three states, last-one-disabled with tooltip; reflow tests in Phase 4. |
| T7 | Shortcuts menu: macOS glyphs everywhere, grouped Capture / Listening / View / Answer style / App, "Clear session memory" last in the destructive colour, bindings unchanged | 3 | `ActionMenu` | Unit: group order, glyphs derived from `COMMAND_KEYS`, destructive item last; `commands.test.ts` unchanged. |
| T8 | Paused: capture and mic dimmed, slashed, not clickable ("Resume to capture"); answer style, panel toggles, see-through, shortcuts stay usable | 3 | `SplitButton`, `IconButton` (`disabledReason`) | Unit: disabled controls and tooltip; the mode menu stays openable (4.2). |
| T9 | One size system: controls 36 px (52 px labelled), radius 10, gap 6, separators 20 px, 20 px outline icons (filled only for active/primary), split buttons share one border with a 1 px divider | 1, 3 | tokens, `Toolbar` | Computed-style test of heights, radius, gaps and divider; no per-control size overrides left in app CSS. |
| M1 | Never write mic or recording status into the transcript; it holds speech turns, chat messages and one-line capture event chips | 4 | `Transcript` | Test: the recording-status lines are never appended; chips render for "no question found" and "answered". |
| M2 | Red dot in the transcript header deleted | 4 | `Panel` | Test: header has no record indicator; footer record icon is the single "live" indicator. |
| M3 | Analysis progress only as the step list in the Answer panel plus a "Stop" button in the Answer header; banner and "Capturing the screen…" chat message removed | 4 | `Panel`, `Steps`, `Button` | Test: one progress surface; no banner and no chat line; Stop ends the run. |
| M4 | "Last capture 08:33 · no question found" as right-aligned Answer header meta plus the transcript chip; empty-state body unchanged | 4 | `Panel` meta, `Transcript` event | Test: meta text and chip; no loose top-left text. (`no-question.test.tsx`) |
| M5 | Each panel is a flex column (header 40, body flex 1 scrolling, optional dock); nothing positioned against the window; the empty-state Capture button sits inside the body | 4 | `Panel` | Test: no `position:absolute` against the window in panel CSS; the button is inside the Answer body at 330/300/900. |
| M6 | "To apply" is a dock at the bottom of the Answer panel (count, thumbnails, Add screenshot, Clear, primary Apply), only while items are pending; apply behaviour unchanged | 4 | `Panel` dock | Test: dock present only with items; Apply/Clear/Add fire the existing handlers; does not overlap the footer. |
| M7 | Every panel has a 40 px header (title, meta, optional action); empty states use a 40 px icon tile, optional title, one line, optional action; Code waiting copy "Starts automatically after the approach." | 4 | `Panel`, `Empty` | Test: header height and copy strings in all three panels. |
| M8 | Composer: mic neutral, red only while dictating; Send muted until there is text | 4 | `Composer`/`Input` | Unit: states; dictation behaviour unchanged (`dictation.ts` tests). |
| M9 | Transcript: 28 px top fade, thin overlay scrollbar, sticks to the bottom, "Jump to latest" pill when scrolled up | 4 | `Panel` `scroll`, `useFollowLatest` | Real-wheel test: scroll up shows the pill, click returns and follows; new message sticks. |
| M10 | Transcript 330 px (min 300); other visible panels share the rest equally; footer spans the full row; nothing cropped at ≥ 900 px | 4 | `Panel` widths | Browser test at 900 and 1,180 for 1, 2 and 3 visible panels; `windowWidthFor` tests stay green. |
| M11 | See-through lowers panel backgrounds only; text and icons stay at full opacity | 1, 4 | `--oui-panel-see-through` | Computed-style test at 0.22: backgrounds alpha 0.22, text colours opaque. |
| F1 | Footer left: filled red record icon and monospace timer, no "Live" text; paused: amber pause icon, amber timer, "Paused" label; nothing else changes colour | 2 | `StatusClock`, `SessionBar` | Unit per state; the timer excludes paused time (4.2). |
| F2 | Build tag `<short sha> · <branch>` in mono after a divider, dev builds only (`!app.isPackaged`), full SHA in the tooltip, click to copy; hidden in production | 2 | `StatusClock` `buildTag` | Unit: present with `!isPackaged`, absent when packaged; copy writes the full SHA. |
| F3 | One Resume: paused banner deleted; footer toggles "Pause session" (outline, filled pause icon) / "Resume session" (green filled, filled play icon); behaviour unchanged | 2 | `SessionBar` | Unit: single Resume in the DOM; label and icon fill per state. |
| F4 | End session is an outlined red button; behaviour including confirmation unchanged | 2 | `SessionBar` `end.confirm` | Unit: outline tone; confirmation still gates End. |
| F5 | The footer contains only its own items (no floating Capture or To-apply tray) | 2, 4 | `SessionBar`, `Panel` | Test: footer children are the clock, tag and actions only; overlap check at 900. |
| F6 | The footer background never changes with state; state shows only through icon and timer colour | 2 | `SessionBar` | Computed-style test: identical background live vs paused (and at see-through). |

Visual sign-off: after each phase compare the rendered panels with `board-1a/1c/1d/1e.png` side by side at 2x (colours,
spacing, states), exactly as the library's showcase was reviewed, and attach the comparison to the PR.

## 5. What gets replaced, and with what (old → new)

| Old (app) | New (library) | Notes |
|---|---|---|
| `ui/button.tsx` (`Button`, `BUTTON_VARIANTS`) | `Button` | Map `primary/secondary/ghost/destructive/go/link/glass` to `variant` + `tone`; delete after the last import is gone. |
| `panels/toolbar.tsx`, `toolbar-config.ts` (render parts), capture split, mic split, mode menu, answer-style menu, pane toggles, see-through, shortcuts menu | `Toolbar`, `SplitButton`, `ActionMenu`, `IconButton`, `Segmented`, `Divider` | T1–T9. `toolbar-config.ts` keeps behaviour data (modes, limits, panes, window modes) and loses visuals. |
| `panels/window-dots.tsx` | App-owned wrapper over `IconButton` + `ActionMenu` | No library `WindowDots`; keep the hover-menu logic, restyle with tokens. If the library adds one later, swap then. |
| `panels/popover.tsx`, `settings-popover.tsx`, `source-popover.tsx`, `session-switcher.tsx`, `screen-picker.tsx` | `Popover`, `ActionMenu`, `SettingsDialog` | Keep their models (`display-picker-model.ts`). Portals need the host container (library P0-5). |
| `panels/panel-views.tsx`, chat bubbles and chat input | `Panel` + `Transcript` (entries mode) + `Composer`/`Input` | M1, M2, M8, M9, M10; copy control, `edited` tag, event chips, code blocks via `highlight`. |
| `panels/answer-pane.tsx`, step list, "To apply" tray | `Panel` (header 40, body, dock), `Steps`, `Markdown`, `Tag`, `Button` | M3–M7; keep the answer content model. |
| `panels/code-card.tsx`, `read-only-code.tsx`, `tests-drawer.tsx` | `Panel`, `Segmented`/tabs, `Button`, `Empty` | CodeMirror editor stays app-side (`code-canvas.tsx`); only its chrome moves. |
| `panels/status-strip.tsx`, `strip-model.ts`, `overlay/overlay-footer.tsx` | `SessionBar` + `StatusClock` | F1–F6; build tag only when `!app.isPackaged`; footer background never changes with state. |
| `panels/start-panel.tsx` (866 lines) + `start-panel.css` | `Panel`, `Button`, `Segmented`, `Empty`, `Input`, `Tag` | Keep `start-model.ts`; the banner and Try again stay. |
| `panels/ended-card.tsx`, `mini-player.tsx` | `Panel`, `SessionBar`, `Button` | Keep modes and sizes. |
| Studio pages (31 files using `ui`) | `Button` and friends | Last phase; same props mapping. |

Anything in the table that has no library equivalent (window dots, CodeMirror canvas, mask editor) stays as app code but
must use library tokens and `Button`/`IconButton` for its controls, never `pn-*` button rules.

## 6. Phases (each ends green and is its own PR; do not push to `master`)

**Phase 0: spike and ADR.** Install the published version in a branch; import `styles.css`; screenshot-diff pages that
render no library component (must be zero pixels); render one `Panel` and one `SplitButton` inside the real overlay page;
check a portalled menu in the native window's hit regions; measure bundle size. Write the ADR and the scope checkpoint
(expected change size > 1,000 lines: split by phase).

**Phase 1: adapter and tokens.** `ui/` becomes the adapter: add `ui/theme.css` mapping `--oui-*` from `--ui-*`/`--pn-*`/`--ov-*`
**per surface** (overlay, native panels, Studio, start panel), including `--oui-panel-see-through` (0.22 to 1, backgrounds
only), the dark/light and glass variants, and the control sizes (36/52, radius 10, gap 6). Add the portal host container and
the `data-oui-surface` selector to `HIT_SELECTORS` / `useHitRegions`. Mount `styles.css` at the top of `studio/tokens.css`.
No visible change yet; tests green.

**Phase 2: footer and status strip (F1–F6).** Replace `status-strip.tsx`/`overlay-footer.tsx`/`strip-model` view with `SessionBar`
and `StatusClock`: record icon and mono timer (no "Live" text), paused = amber pause icon, amber timer and "Paused" label,
no tint on pause, one Resume (green filled, filled play icon) / Pause (outline, filled pause icon), outlined red End with the
existing confirmation, build tag `<short sha> · <branch>` (dev builds only, click to copy, full SHA in the tooltip). Delete
the paused banner and the amber footer tint. Keep `PAUSED_NOTICE` behaviour from 4.2 exactly.

**Phase 3: toolbar (T1–T9).** One split capture button (mode lives in its caret menu: "When to analyse" Manual/Auto above
"Display"; Manual neutral, Auto blue tint, no coloured dot, tooltip names the mode); analysing shows the progress ring and a click
or the capture key stops the run; microphone has Zoom semantics (listening neutral, muted red slashed, lost/retrying amber
outline with a "!" badge, caret lists devices, shows "Trying again · attempt n" and "Retry now"); screen problems get the same
badge and lead the caret menu with the reason and a fix action; answer style shows its full name (≤ 260 px, tooltip), grouped
menu (Technical / Conversation), fixed check column, "⌘↑ ⌘↓" hint row (**show the app's real keys**); panel toggles are one
segmented group (the last visible one disabled with a tooltip); shortcuts menu uses macOS glyphs, grouped Capture, Listening,
View, Answer style, App, with "Clear session memory" last in the destructive colour; paused state per 4.2. New data the toolbar
needs (section 7). Remove the mode pill, the coloured dot and the "Microphone lost. Trying again." banner.

**Phase 4: panels (M1–M11).** `Panel` for Transcript & chat, Answer and Code (header 40, body flex 1 scrolling, optional dock;
nothing positioned against the window); `Transcript` for the chat (event chips, `edited`, copy, fade, thin scrollbar, jump to
latest); `Composer` with mic neutral turning red only while dictating and send muted until text; the "To apply" dock inside
the Answer panel; the Capture button inside its panel; see-through on backgrounds only; remove the red dot in the transcript
header and every system line from the transcript; reflow per 4.1.

**Phase 5: start panel, ended card, mini player, popovers.** As in the table. The start panel and ended card use the same
tokens, `Button` and `Panel`.

**Phase 6: Studio web pages.** Swap `ui/button.tsx` usages (89) for the library `Button`; migrate any remaining `studio-*`
button families. Keep page behaviour; run the browser tests (`pnpm test:browser`).

**Phase 7: delete.** Remove everything in the deletion ledger (section 9), add the guard tests, regenerate docs
(`pnpm docs:arch`, and the `bionic-regeneration` skill for `bionic/code/`), update `bionic/research/references/ui-components.md`
and journal the cycle (`log-work`).

## 7. New data the new UI needs (add to contracts and state; this is the only "new behaviour")

- **Microphone devices and status** for the caret menu: device list, selected device, `lost`/`retrying` with `attempt`,
  a "Retry now" action (the `Alt+R` toggle is unchanged). Source: the capture companion / shell bridge.
- **Persistent screen-problem state**: permission missing, chosen display disconnected, last capture failed, each with a fix
  action ("Open System Settings", "Pick display"). Today these are transient; keep them until resolved.
- **Build tag**: short SHA, branch and `isPackaged` from the shell/build (`overlay/build-id.ts` exists); the tag shows only
  when `!isPackaged`.
- **Grouped answer styles and shortcut groups** (Technical / Conversation; Capture, Listening, View, Answer style, App):
  pure data in `toolbar-config.ts`/contracts, bindings unchanged.
- **Answer header meta**: "Last capture HH:MM · no question found" and the capture event chips for the transcript.

## 8. Native, Swift and what a cloud session cannot verify

- Cloud sessions cannot run the macOS shell, `WKWebView`, ScreenCaptureKit or `swift` (`pnpm verify` skips native steps off
  macOS with a message; do not treat that as a pass for native behaviour). They **can** run: `pnpm lint`, `pnpm format`,
  `pnpm typecheck`, `pnpm test:no-docker`, `pnpm build`, the vitest suites for panels, and Playwright against the web build
  (`pnpm test:browser`, needs Docker for the full stack; use the `no-docker` projects otherwise).
- Swift changes (only if needed): `HIT_SELECTORS`/portal marker handling in `WindowDrag.swift` and `HitRegionTracker`, the 40 px
  rule, `PanelChrome` invariants (`windowHasShadow` false). Any Swift edit needs the matching `Tests/StudioShellTests` change
  and the owner to run `cd apps/studio-shell && swift build && swift run studio-shell-tests`.
- **Owner manual QA checklist (write it into the PR; the owner runs it on the built app, installed to
  `~/Applications/Interview Studio.app`)**: drag from toolbar, footer and panel headers; click-through on undrawn areas; cursors
  (grab, pointer, text) with the app inactive; select and copy transcript text and a code block; open every toolbar menu and
  confirm it is clickable (portals); pause and resume (timer excludes paused time, panels hide and return); mic muted,
  lost and retry; screen permission lost; see-through at 100/60/22 (text crisp); window modes Normal/Mini/Full; the green
  menu hover; quit confirmation; start panel after End; lost-session banner and recovery.
- Build for the owner: `swift build -c release && scripts/bundle-app.sh` (in `apps/studio-shell`), then copy the bundle to
  `~/Applications`. The web half is rebuilt with `pnpm app:up`. Do not boot dev servers unprompted.

## 9. Deletion ledger and guards (rule 1, enforced)

Delete once nothing references them (confirm with `rg` using explicit paths, never a bare `rg`):

- `ui/button.tsx`, `ui/ui.css`, `ui/button.test.tsx`, `ui/studio-button-retired.test.ts`, `ui/join.ts`, and the button parts
  of `ui/tokens.css` (keep the adapter mapping).
- In `panels/`: the rendering code and class names of `toolbar.tsx`, `status-strip.tsx`, `panel-views.tsx`, `answer-pane.tsx`,
  `code-card.tsx`, `tests-drawer.tsx`, `start-panel.tsx`, `ended-card.tsx`, `mini-player.tsx`, `popover.tsx`, `screen-picker.tsx`
  views, and the matching blocks of `panels.css` and `start-panel.css`. Models and behaviour files stay.
- `overlay/overlay.css` (`ov-*`, 1,838 lines), `overlay-card.tsx`, `chat-log.tsx`, `command-bar.tsx`, `overlay-footer.tsx`,
  `overlay-capture.tsx`, `overlay-task.tsx`: **audit first** whether the overlay card path is still reachable in the native
  single window; delete what is unreachable, port what is reachable, and record the finding in the PR.
- The legacy button families (`pn-*`, `ov-*`, `studio-*` button rules) and any `Button`-like local components.

Guard tests to add (in `scripts/` or beside `studio-button-retired.test.ts`):
1. No file under `products/interview/src/frontend` imports `ui/button` (or the removed paths).
2. The removed CSS families do not reappear (`panels.css`, `overlay.css` button and bar selectors).
3. Every interactive control under `studio/live/overlay/panels` renders through a library component (grep for raw
   `<button` in the panel files that were swapped, allow-listing the few app-owned ones with a reason).
4. The shortcut table is the contract: a test pins `COMMAND_KEYS` and asserts the rendered glyphs come from it.

## 10. Test plan

- Keep and run every test in 4; update selectors (`.pn-*` class hooks) to roles, titles and `data-slot`, never loosen an
  assertion. Add the missing ones **before** deleting an old component (hit regions with portals, footer states, toolbar
  states, paused locks, mic/screen badges, answer-style menu, shortcut glyphs, copy and `edited`).
- Add Playwright (web build) checks for the swapped panels at 900 and 1,180 px and at 330/300 transcript widths.
- Full gate before every PR: `pnpm lint && pnpm format && pnpm typecheck && pnpm test:coverage && pnpm build` (plus
  `node scripts/verify-native.mjs` on macOS). The pre-push hook runs `pnpm verify`; never bypass it.
- After the last phase: `pnpm docs:arch` and regenerate `bionic/code/`; `pnpm docs:arch:check` must exit 0.

## 11. Risks to watch

1. **CSS bleed** (library resets or layers restyling the app). Mitigation: Phase 0 spike and the zero-pixel diff.
2. **Portals vs hit regions** (menus unclickable in the native window). Mitigation: container prop and `data-oui-surface`,
   owner QA of every menu.
3. **See-through** (opacity must apply to backgrounds only; text and icons stay opaque).
4. **Bundle size** (chat dependencies pulled into the panel page). Mitigation: library entry points.
5. **Shortcut drift** (designer glyphs leaking into the UI). Mitigation: contract in 4.5 and its test.
6. **Test churn hiding regressions** (class-hook tests rewritten loosely). Mitigation: roles/titles, never weaker assertions.
7. **Scope**: five-plus thousand lines of TSX and three stylesheets. Mitigation: phases, one PR each, scope checkpoint.

## 12. Working agreement for the cloud session

- Work on a branch per phase (for example `ui-swap/phase-2-footer`); open a PR per phase; **never push to `master`, never
  publish the library, never edit Crux or `.claude` configuration.** Run `pnpm verify` (pre-push) and fix, do not skip.
- Follow AGENTS.md: simplicity first, one responsibility per package, no speculative layers, comments before major logic
  blocks, domain names. Journal with `log-work`; record the decision with `propose-adr`.
- Review your own work against the boards and the behaviour contract; report honestly what was verified by test, what by
  browser, and what is left for the owner's native QA.
- Preferences from the owner: no unprompted dev-server runs; generate with agent runtimes, not local LM Studio models; real
  document templates (they embed personal data) stay out of git.

## 13. Reference

`bionic/inbox/redesign/ui-components/`: `plan.md` (Phase 2 decisions and review gate), `native-panel-cleanup-brief.md`
(owner's T/M/F requirements, verbatim), `gap-toolbar.md`, `gap-panels-footer.md`, `audit-native.md`, `audit-web-buttons.md`,
`audit-web-primitives.md`, `audit-reference-fit.md`, `slice4-remaining.md`, `agentchat-equivalents.md` (features still missing
for a future chat), `omnitech-assistant-inventory.md` (what was ported into the library). Library:
`omni-ui-components/bionic/research/references/native-app-control-variations.md`, the showcase in Storybook, and the plan above.
