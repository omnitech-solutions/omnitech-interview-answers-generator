# Gap audit: Top toolbar (T1-T9), Worker E, 2026-10-06 (read-only)

LIB = `/Users/desoleary/dev/omnitech-solutions/omni-ui-components/packages/core/src`. APP = `products/interview/src/frontend/studio/live/overlay/panels`. GAL = the designer gallery (`Native Panel Cleanup.dc.html`, board 1a/1c/1d data in the `<script data-dc-script>` block, lines 265-340; board 1b ignored except its 52px labelled rows, which the brief requires).

## 0. Facts that shape everything

- LIB is React + Tailwind + `cva` + Radix + lucide. Each folder is `X.tsx`, `X.types.ts`, `X.variants.ts`, `X.stories.tsx`, `X.factories.tsx`, `index.ts`; tokens are `--oui-*` (`LIB/styles/tokens.css:4-30`); tests live in `packages/core/test/<Name>/` (Vitest + Testing Library, e.g. `test/Progress/Progress.test.tsx`).
- APP is plain CSS (`panels.css`, `--pn-*`, 1890 lines) with hand-rolled `Popover` (`popover.tsx:39`). The product already has its OWN Button and token layer (`products/interview/src/frontend/ui/{button.tsx,tokens.css}`, `--ui-*`, heights 28/32/40) and does not import LIB components in source; `apps/web/app/layout.tsx:5` imports only `@oc-tech/omni-ui-components/styles.css`, and LIB is vendored as a tarball (`vendor/omni-ui-components/oc-tech-omni-ui-components-0.0.2.tgz`, root `package.json:58`). See open question Q1: the brief ("native and Storybook share the SAME components") and plan.md decision 1 ("home = product `ui/`") conflict.
- Existing LIB parts relevant here (real signatures):
  - `Button/Button.types.ts:17`: `variant` default|destructive|outline|secondary|ghost|link; `buttonSize` sm|default|md|lg|icon (heights 24/32/40/48px via `--oui-field-height-*`); `icon`, `iconAfter` nodes; radius `--oui-radius-field` = 6px. Base class has `disabled:pointer-events-none` (`Button.variants.ts:16`).
  - `IconButton/IconButton.types.ts:16`: `icon: ReactNode` (required), `variant` (same six), `iconSize` sm|default|md|lg, `label` (aria-label alias), `title`. No tone, badge, pressed, caption, tooltip.
  - `Segmented/Segmented.types.ts:6,18`: `options: {value,label,disabled?}[]`, single-select only, `onChange(next: string)`, pill look (`rounded-full`, `h-8`), filled `bg-primary` when on.
  - `Dropdown/Dropdown.tsx`: re-exports Radix wrappers (`DropdownContent|Item|RadioItem|Label|Separator|Shortcut|Group...`) from `components/ui/dropdown-menu.tsx`. Content already has `max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto` (:64) and a left check column on Radio items (:121-130). Label is forced uppercase xs (:144). No sections-from-data, no two-line item, no tone, no footer/notice. `Menu/Menu.tsx` is an inline nav tree (`items {key,label,icon,children,onClick}`), not a popup.
  - `Progress/Progress.tsx:5`: bar only (`percent`, `status`). `Spin` is an overlay with a `Loader2` icon. `Badge` (`Badge.types.ts:3`) is a pill div, no positioning. `Tooltip/Tooltip.tsx` is three compositional parts (`Tooltip`, `TooltipTriggerRoot`, `TooltipPopup`). `Divider` vertical = Radix Separator `h-full w-px`. `Popover` = Radix wrappers.
  - `showcase/` holds only `entities.ts` (form demo data). Real overview rows are `SECTIONS` in `.storybook/getting-started/ComponentOverview.stories.tsx:798-1013` (Actions section at :824, fed by `X.factories.tsx` variant arrays).
- Current APP behaviour that must survive (callbacks, props): capture button is `disabled` when `lock!==null || !s.open || phase==="capturing"`, `onClick -> s.press("capture")`, right-click and ArrowDown open the screen menu, `aria-haspopup/expanded`, tooltip = `captureButtonTitle(...)` (`toolbar.tsx:79-151`); mic `aria-pressed`, `data-mic`, `data-held`, disabled when held, `s.press("toggle-mic")` (:153-193); mode menu radio items `s.setAuto(...)` and `attach` item with `disabledReason` (:309-343, `toolbar-config.ts:52-87`); style menu `s.setSkill(id)`, checked = `s.skill ?? DEFAULT_SKILL`, `testId="pn-skill"` (:348-393); panes `aria-pressed`, `controls.panes.toggle(id)`, **currently disabled while paused** (:404-417); See-through never locked, `glass.toggle` (:197-220); keys dialog from `shortcutsFor("native")` (`live/shared/shortcuts.ts:90`); `onMenuOpen(open)` keeps window room (:236-238, `POPOVER_ROOM`); every control reads `ToolbarLock` (`toolbar-lock.ts`) and becomes disabled with the reason as title. Test ids in use: `pn-pill, pn-dot, pn-status, pn-skill, pn-screen, pn-pin-dot, pn-see-through, pn-level, pn-model`. Native hit/drag rules key off `.pn-pill`, `.pn-menu` (`hit-regions.ts` `HIT_SELECTORS`) and the `disabled`/`aria-disabled` probe.

## 1. Per-item gap analysis

Abbreviations for proposed parts: **IB** = IconButton (+variation), **SB** = SplitButton (new), **AM** = ActionMenu (new), **TB** = Toolbar container (new), **SG** = Segmented (+variation), **PR** = Progress `shape="ring"`, **BTN** = Button (+variation).

### T1 Capture split button, mode merged, tint, no dot
(a) Parts: split button (main + caret sharing one border), tinted state (neutral=Manual, blue=Auto), tooltip naming the mode, caret menu with sections "When to analyse" (two-line radio items with shortcut) and "Display" (radio rows with live thumbnails, a disabled "Add screen to this problem" action).
(b) Existing: IB (`IconButton.types.ts:16`) for the main face only; `Dropdown*` primitives for the menu JSX. Nothing groups two buttons; no tint.
(c) Gap: **NEW COMPONENT SB**, **NEW COMPONENT AM**, **VARIATION IB** (`tone`, `tooltip`).
- Why SB cannot be an IB variation: it owns two hit targets, one border, a 1px divider and one menu anchor; the caret must open on caret click, right-click and ArrowDown of the main part (today `toolbar.tsx:116-128`).
- Why AM is not a Menu variation: `Menu` is an inline accordion tree; five menus here share one popup-with-sections shape and the Radix `Dropdown` is JSX-only.
```ts
type Tone = "neutral" | "accent" | "warning" | "danger" | "dim";
interface ControlSpec {            // shared by IB, SB.main, BTN
  icon: ReactNode; caption?: string;          // caption shown only in labelled size
  tone?: Tone; pressed?: boolean;             // pressed => aria-pressed + tone fill
  tooltip?: ReactNode; tooltipSide?: "top"|"bottom";
  badge?: { content: ReactNode; tone: Tone } | null;   // "!" top-right
  disabled?: boolean; disabledReason?: string; // aria-disabled, stays hoverable, tooltip = reason
  "aria-label": string; testId?: string;
  onClick?: (e: MouseEvent) => void;
}
interface SplitButtonProps {
  main: ControlSpec;
  caret: { label: string; testId?: string; tone?: Tone; disabled?: boolean; disabledReason?: string };
  menu: ActionMenuSpec;                        // see AM
  open?: boolean; onOpenChange?: (open: boolean) => void;   // native: window room
  openMenuOn?: Array<"caret" | "contextmenu" | "arrowdown">; // default ["caret"]; capture passes all three
  returnFocus?: "main" | "caret";
  menuSide?: "bottom"|"top"; menuAlign?: "start"|"end"; menuCollisionPadding?: number;
}
interface ActionMenuSpec {
  label: string; width?: number | string; maxHeight?: number | string; // default: Radix available height
  notice?: { tone: Tone; icon?: ReactNode; title: string; detail?: string;
             action?: { label: string; onSelect: () => void } };      // T3/T4 lead row
  sections: Array<{
    id: string; heading?: string; headingStyle?: "plain" | "caps";
    selection?: "none" | "single";            // single => radio semantics, fixed check column
    items: Array<{
      id: string; label: string; description?: string; icon?: ReactNode;
      shortcut?: string;                      // pre-formatted glyphs, e.g. "⌘⇧S"
      checked?: boolean; tone?: "default" | "danger";
      disabled?: boolean; disabledReason?: string;
      content?: ReactNode;                    // slot replacing the row body (display thumbnails)
      onSelect?: () => void;
    }>;
  }>;
  hint?: { label: string; keys: string };     // T5 footer "Previous / next  ⌘↑ ⌘↓"
  kind?: "menu" | "list";                     // list = read-only rows (T7), role=dialog via Radix Popover
}
```
Placement: `menuSide/menuAlign/menuCollisionPadding` (Radix), plus `Toolbar` slot order is JSX order (no absolute positioning).
(d) Stories: `SplitButton/Manual`, `/Auto`, `/MenuOpen`, `/Disabled`, `/Labelled`; `ActionMenu/CaptureModes`, `/WithDisplayRows`, `/DisabledItemWithReason`.
Showcase boards (Native App): "1a Live manual", "1a Live auto", "1c Caret menus: capture", "1b Labelled live manual/auto" (row 52px).
(e) Tokens: tone `accent` fg #a9c1ff, bg rgba(91,140,255,.18), border #3b5f9e (GAL TONE.auto); neutral fg #e8e8ea bg #262a33 border #363a44; divider = border colour; menu surface #22252d border #343843 radius 12 pad 6, item radius 7, selected bg rgba(91,140,255,.1).
(f) Tests (LIB `test/SplitButton`, `test/ActionMenu`, `test/IconButton`): caret opens menu; right-click and ArrowDown on main open it when configured; Escape returns focus per `returnFocus`; `tone` sets `data-tone`; one shared border (no seam: caret has no own border, divider is 1px); `disabledReason` blocks onClick yet tooltip shows; radio items expose `role=menuitemradio aria-checked`; fixed check column present for unchecked rows; `onSelect` fired once and menu closes. APP: update `panels.test.tsx:180-201` (dot gone, tint asserted), `screen-picker.test.tsx` (pin dot moves to caret as `badge`/`tone`), add mode-in-menu test, ⌥⇧U unchanged (`commands.test.ts`).

### T2 Analysing: progress ring on capture
(a) Ring icon in the main face; click/⌘⇧S stops; no banner (M3, out of scope).
(b) `Progress/Progress.tsx` is a bar only; `Spin` is an overlay. IB takes any node.
(c) **VARIATION** on Progress:
```ts
interface ProgressProps { shape?: "bar" | "ring"; /* default "bar" */
  percent?: number;            // undefined with shape="ring" => indeterminate spin
  size?: number;               // ring diameter px, default 20
  tone?: Tone; "aria-label"?: string }
```
Caller passes `<Progress shape="ring" tone="accent" />` as `icon` and `tone="accent"` on the button (GAL TONE.busy: fg #8fb0ff, bg rgba(91,140,255,.12), border #3b5f9e). Stop semantics stay in product (`captureControl(analysing)`, `toolbar-config.ts:~265` supplies label "Stop").
(d) Stories: `Progress/RingIndeterminate`, `/RingDeterminate`; `SplitButton/Analysing`. Board "1a Analysing".
(e) Tokens: `--oui-ring-track`, `--oui-ring-stroke: 2px`; tone colours as above.
(f) Tests: ring renders `role=progressbar`, `aria-valuenow` only when determinate; reduced-motion removes spin (`--oui-transition-duration`); APP: the "Capturing the screen" banner absent (capture-ui.test.tsx), press on analysing still calls `press("capture")`.

### T3 Mic with Zoom semantics, badge, device menu
(a) Split button (mic + caret), states listening (neutral, white mic), muted (danger, slashed mic), lost/retrying (warning outline + "!" badge), menu with notice (status + Retry now), devices (radio), "Stop listening ⌥R".
(b) IB + SB + AM as T1. No level bars (drop `.pn-level`).
(c) **NONE beyond T1/T2 parts** (tone `danger`, `warning`, badge are the shared IB variation). Product-side gaps, not library: (1) there is no device list or "attempt n" in the session today (grep: only `use-engine.ts:251` "Microphone lost. Trying again."); (2) `Retry now` has no existing action (⌥R toggles). Both need a product decision (Q3).
(d) Stories: `SplitButton/MicListening`, `/MicMuted`, `/MicLostRetrying`, `ActionMenu/MicLostWithDevices`. Boards "Mic lost · retrying", "Mic muted by you", labelled "Mic lost".
(e) Tokens: warning fg #f5c86b bg rgba(240,180,41,.12) border #a07a22; badge bg #f0b429 fg #1b1400, 16px, offset -6px, 2px ring in toolbar surface (#1b1e25); danger fg #ff6b66. Map to `--pn-warn`/`--pn-danger` in the `.pn-root` scope.
(f) Tests (APP): `aria-pressed` and `data-mic` preserved, held mic disabled with reason (`MIC_HELD_TEXT`), badge appears only for `lost`, banner removed, ⌥R unchanged.

### T4 Screen problems on the capture button
(a) Same warning tone + "!" badge on SB.main; caret menu leads with `notice` (reason + fix action).
(b) Same as T1/T3. Data exists: `CaptureProblem {reason,title,fix,action}` (`live/shared/capture-problem.ts:61`, action id `open-screen-recording-settings` :57), `CaptureFailure` (`capture-failure.ts`), `pinDropped` (`screen-picker.tsx:136`, today a one-shot toast).
(c) **NONE** (uses `notice` of AM and `badge`/`tone` of IB). "Pick display" action = `notice.action.onSelect` that opens the Display section.
(d) Stories: `SplitButton/ScreenPermissionLost`, `/DisplayDisconnected`, `/LastCaptureFailed`, `ActionMenu/NoticeWithFix`. Board "Screen permission lost".
(e) Tokens: as T3; notice bg rgba(240,180,41,.12), border #6b5420, title #f5c86b, detail #d9c79a.
(f) Tests (APP): a persistent "problem" selector (new, from last failure/permission/pin) maps to tone+badge+notice; clears on success.

### T5 Answer style: full name, grouped menu, hint row
(a) Trigger button (icon + label + chevron, max 260px then ellipsis, tooltip with full name); menu: heading, groups Technical/Conversation, fixed check column, viewport-sized scroll, footer hint.
(b) `Button` (`variant="outline"`, `icon`, `iconAfter`) for the trigger; `Dropdown*` for the menu (scroll via available-height already at `components/ui/dropdown-menu.tsx:64`).
(c) **VARIATION** on Button/IB: control size + label truncation + tooltip:
```ts
// ButtonVariantProps additions
buttonSize: ... | "control" | "control-labelled";   // 36px / 52px, radius 10px
labelMaxWidth?: number | string;                      // truncates children with ellipsis
tooltip?: ReactNode;                                  // auto-shown when truncated or always
```
Menu = AM (sections, `hint`, `width`, default max-height = available height, so the cut-off bug is solved without new props). Grouping needs data not in the contract today: `LIVE_OWNER_SKILLS` (`shared/skills.ts`) has no group field (Q4).
(d) Stories: `Button/ControlTruncated`, `ActionMenu/AnswerStyleGrouped`, `/AnswerStyleScrolling` (viewport 600px). Board "1c Answer style menu".
(e) Tokens: `--oui-control-label-max: 260px`; group head 11px uppercase .05em #6c707a; select fill #262a33 border #363a44.
(f) Tests: long label gets ellipsis and `title`/tooltip; menu `max-height` bounded in a small viewport; checked row has check icon, unchecked row keeps the column (same left offset); `⌘↑ ⌘↓` hint rendered; `s.setSkill` called; `data-testid="pn-skill"` kept.

### T6 Panel toggles as one segmented group
(a) Bordered group of 3 icon toggles; active = blue tint fill; last visible cannot be switched off (disabled + tooltip).
(b) `Segmented` (`Segmented.types.ts`) is single-select, text, pill, `bg-primary`.
(c) **VARIATION** on Segmented:
```ts
interface SegmentedOption { value: string; label: ReactNode; disabled?: boolean;
  icon?: ReactNode; caption?: string; tooltip?: ReactNode; disabledReason?: string; testId?: string }
interface SegmentedPrimitiveProps {
  mode?: "single" | "multiple";                   // default "single"
  values?: string[]; onValuesChange?: (next: string[]) => void;   // multiple
  appearance?: "pill" | "control";                // control: 10px outer / 8px inner radius, 36|52px, tone accent when on
  size?: "control" | "control-labelled";
}
```
The "last cannot be off" rule stays caller data: product marks the sole active option `disabled` + `disabledReason` (no `minSelected` logic in the library). Note current code disables panes while PAUSED (`toolbar.tsx:411-412`) but T8 says toggles stay usable: behaviour change to confirm (Q5).
(d) Stories: `Segmented/PanelToggles`, `/LastVisibleLocked`, `/Labelled`. Board "1a panel toggles", "Paused · code hidden".
(e) Tokens: on bg rgba(91,140,255,.24), fg #a9c1ff; border #363a44; 2px padding, 2px gap; radius 11/8.
(f) Tests: multi-select toggling emits full `values`; locked option does not emit and exposes tooltip; keyboard arrows; `aria-pressed` on each (APP tests that read `aria-pressed` on pane buttons stay valid).

### T7 Shortcuts menu: glyphs, grouped, destructive last
(a) Trigger icon button; read-only grouped list with mono glyph column; last row destructive.
(b) IB trigger; `DropdownShortcut` exists (`dropdown-menu.tsx:158`) but no grouping data, mono, or tone.
(c) **NONE new** beyond AM (`kind:"list"`, `sections` with `headingStyle:"caps"`, item `shortcut`, `tone:"danger"`). Product supplies groups Capture, Listening, View, Answer style, App from `shortcutsFor("native")` (needs a `group` field on `Shortcut`, `shortcuts.ts:25`) and drops "Alt+R" notation in the chat (web table `COMMAND_KEYS`, out of this section).
(d) Stories: `ActionMenu/ShortcutsGrouped`. Board "1c Shortcuts".
(e) Tokens: `--oui-font-mono` (Geist Mono / ui-monospace), shortcut colour #8a8e98, danger #ff8a85.
(f) Tests: groups in the designed order; destructive row last and coloured; glyph-only chords (no "Alt+"/"Cmd"); `shortcuts.test.ts` still reads `Hotkeys.swift`.

### T8 Paused state
(a) Capture (both parts) and mic dimmed + slashed, not clickable, tooltip "Resume to capture"; others usable.
(b) IB `disabled` exists but base class kills pointer events (`IconButton.variants.ts:16` `disabled:cursor-not-allowed disabled:opacity-50`; Button `Button.variants.ts:16` `pointer-events-none`), so a tooltip cannot show.
(c) **VARIATION** (already in `ControlSpec`): `tone:"dim"` + `disabledReason` implemented as `aria-disabled="true"` + `data-disabled`, no `pointer-events:none`, click swallowed. Native probe: `aria-disabled` is already in the shell's drag/cursor probe list (plan.md:57), but confirm `HIT_SELECTORS` tests.
(d) Stories: `SplitButton/Paused`, `IconButton/DisabledWithReason`. Board "Paused · code panel hidden", labelled "Paused".
(e) Tokens: dim fg #5f636c, bg transparent, border #2c3038.
(f) Tests: click does nothing, tooltip text equals reason, menu does not open from caret while paused (Q6: current code keeps the mode menu open when paused, `toolbar.tsx:262-263`; T1 moves mode into the capture caret).

### T9 One size system
(a) Tokens + one container applying size to children: 36px (52px labelled), radius 10, gap 6, separator 20, icon 20 outline (filled only on active/primary), split shares one border.
(b) `--oui-field-height-*` are 24/32/40/48px, radius 6px (`tokens.css:17-21`); no control scale; `Divider` vertical is full height.
(c) **NEW COMPONENT TB** (small) + **VARIATION** tokens/sizes:
```ts
interface ToolbarProps { size?: "control" | "control-labelled"; label: string; // aria-label, role=toolbar
  gap?: number; "data-testid"?: string; className?: string; children: ReactNode }
```
TB sets a CSS variable scope and a React context so IB/BTN/SB/SG/Divider read the size without each passing it (one place for 36/52). Separators = existing `Divider orientation="vertical"` with `className="h-[var(--oui-control-separator)]"` (NONE for Divider). The window frame, traffic-light dots (`window-dots.tsx`, quit confirm, size menu bound to the Swift shell) and the `.pn-pill` class are **CUSTOM-OMIT** from the library; the native app wraps TB's children in its own `.pn-pill` element (hit-region/drag lists key off it, `hit-regions.ts`).
(d) Stories: `Toolbar/Compact`, `/Labelled`, `/AllStates`. Boards 1a (7 rows) and 1b labelled (4 rows).
(e) New tokens (LIB `styles/tokens.css`, native overrides in `.pn-root`): `--oui-control-height: 36px`, `--oui-control-height-labelled: 52px`, `--oui-control-radius: 10px`, `--oui-control-gap: 6px`, `--oui-control-separator: 20px`, `--oui-control-icon: 20px`, `--oui-control-caret: 20px`, `--oui-tone-{neutral,accent,warning,danger,dim}-{fg,bg,border}`, `--oui-badge-{bg,fg,ring}`, `--oui-menu-{bg,border,radius}`.
(f) Tests: computed-style snapshot of heights/radius/gap per size (jsdom-safe by reading CSS variables on the scope); caret has no border-left except the 1px divider; labelled mode shows captions; native `layout-rules.test.ts` 40px hit-area rule must be revisited (36px controls; the plan keeps 40px for live buttons, Q7).

## 2. Consolidated components and variations (ranked by reuse)

| # | Part | Kind | Items | LIB path |
|---|---|---|---|---|
| 1 | Control tokens and tone scale (`--oui-control-*`, `--oui-tone-*`) | tokens | T1-T9 (9) | `styles/tokens.css` |
| 2 | Toolbar container (size context, role=toolbar) | NEW | T1-T9 (9) | `Toolbar/` |
| 3 | IconButton: `tone, pressed, badge, caption, tooltip, disabledReason`, sizes `control, control-labelled` | VARIATION | T1,T2,T3,T4,T7,T8,T9 (7) | `IconButton/` |
| 4 | SplitButton | NEW | T1,T2,T3,T4,T8,T9 (6) | `SplitButton/` |
| 5 | ActionMenu (sections, items, notice, hint, kind list) | NEW | T1,T3,T4,T5,T7 (5) | `Dropdown/ActionMenu.tsx` |
| 6 | Button: control size, `labelMaxWidth`, `tooltip` (answer-style trigger) | VARIATION | T5,T9 (2) | `Button/` |
| 7 | Divider as control separator | NONE (className + token) | T9 (1) | `Divider/` |
| 8 | Progress `shape="ring"` | VARIATION | T2 (1) | `Progress/` |
| 9 | Segmented `mode="multiple"`, `appearance="control"`, icon options | VARIATION | T6 (1) | `Segmented/` |
| 10 | WindowDots, `.pn-pill`, quit/size popups, `ToolbarLock` context | CUSTOM-OMIT | T9 | stays in APP |

Net: 3 new components (Toolbar, SplitButton, ActionMenu), 4 variations, 1 token set. ActionMenu is the only new component with real logic; Toolbar is deliberately thin.

## 3. Proposed slice order
1. Tokens (#1) and IconButton variation (#3) with stories and tests; ComponentOverview rows.
2. Divider usage, Button variation (#6), Progress ring (#8).
3. Toolbar container (#2) and SplitButton (#4).
4. ActionMenu (#5), then Segmented variation (#9).
5. Native App showcase: `.storybook/native-app/NativePanelToolbar.stories.tsx` plus shared state-matrix factories (`packages/core/src/showcase/native-toolbar.ts`) reproducing GAL rows (tbCompact 7, tbLabelled 4, capture/mic/style/keys menus); the native config builder (session to specs) is typed by the same specs.
6. Native wiring in APP (T1-T9 together, one reviewed slice): build and vendor the tarball, replace `toolbar.tsx`/`popover.tsx` bodies with spec builders, delete `.pn-dot`, `.pn-level`, `.pn-split-*` CSS, update `HIT_SELECTORS` for Radix portals (menus and tooltips render in a portal outside `.pn-menu`), keep `onMenuOpen`/`POPOVER_ROOM` via `onOpenChange`, update tests.

## 4. Open questions for the owner
- **Q1** Where do shared components live? LIB (Tailwind/Radix/cva, vendored tarball, `--oui-*`) versus product `ui/` (plain CSS, `--ui-*`, already has Button). The brief needs one set used by native and Storybook; that means native consumes LIB and the product `ui/Button` and `--ui-*` layer are retired or mapped. Which wins, and who owns the tarball release step?
- **Q2** Icons: designer uses Material Symbols (FILL axis), LIB uses lucide. Keep icons as caller-supplied nodes (native passes its `Icon`; stories use a story-only Material helper), or add an icon-set decision?
- **Q3** Mic caret needs a device list, "attempt n" and a Retry action that do not exist in the session today. Build them, or ship the caret with only status plus "Stop listening"?
- **Q4** Skill groups (Technical / Conversation) and shortcut groups need new fields in `@omnitech/interview-contracts` / `shortcuts.ts`. OK to add?
- **Q5** T6/T8 say panel toggles stay usable while paused; current code disables them (`toolbar.tsx:411-412`). Confirm the behaviour change.
- **Q6** While paused, should the capture caret menu still open (to change mode or display)? T1 moves mode into it, and mode today never locks.
- **Q7** 36px controls versus the 40px live hit-area rule (`layout-rules.test.ts`, plan.md:60): amend the rule for the toolbar?
- **Q8** Radix tooltips/menus in the WKWebView glass window: portals fall outside `HIT_SELECTORS` and the drag rules. Accept adding a portal marker to the selector table (a native-shell contract change)?
- **Q9** T4 needs a persistent "screen problem" state (permission lost, display disconnected, last capture failed); today these are toasts or per-capture. Who owns the selector, and when does it clear?
