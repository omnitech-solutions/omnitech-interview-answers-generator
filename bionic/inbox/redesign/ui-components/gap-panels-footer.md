# Gap audit: main panels (M1-M11) and footer (F1-F6)

Read-only audit, Worker F, 2026-10-06. Spec: `native-panel-cleanup-brief.md`; gallery: `Native Panel Cleanup.dc.html` (sections 2 and 3; board 1b ignored). Library root `LIB` = `~/dev/omnitech-solutions/omni-ui-components/packages/core/src`. Repo root `APP` = `products/interview/src/frontend/studio/live/overlay`.

## 0. What the library really has (facts that drive every verdict)

- Conventions: one folder per component, `X.tsx`, `X.types.ts`, optional `X.variants.ts` (`cva` + Tailwind classes), `X.factories.tsx` (`xPropsFactory` + ordered `xVariants: Variant<P>[]`), `X.stories.tsx` (title `omni-ui-components/X`, `argTypes` with `onClick: { action: 'clicked' }`), `index.ts`, tests in `packages/core/test/X/*.test.tsx`. Tokens are `--oui-*` in `LIB/styles/tokens.css:4-31`; styling is Tailwind utilities compiled into `dist/styles.css`.
- `Button` (`LIB/Button/Button.variants.ts:10-41`): `variant` = default|destructive|outline|secondary|ghost|link; size prop is `buttonSize` = sm|default|md|lg|icon, heights are `--oui-field-height-*` (1.5/2/2.5/3 rem = 24/32/40/48px; no 36px). Has `icon`, `iconAfter`, `type` default. Does NOT have: loading, pressed, tone/green, a shortcut slot. `asChild` is declared (`Button.types.ts:22`) but unimplemented and leaks to the DOM through `...rest` (`Button.tsx:20`): a bug to fix before reuse.
- `IconButton` (`LIB/IconButton/IconButton.types.ts:5-6`): variant same six, `iconSize` sm|default|md|lg, `label` -> aria-label/title. No pressed, tone or badge.
- `Empty` (`LIB/Empty/Empty.tsx:10-16`): dashed bordered box, `min-h-48`, `image`, `description`, `children`. No tile, title or action slot; wrong chrome (dashed border).
- `Steps` (`LIB/Steps/Steps.tsx:5-12`): `items[{title,description,status wait|process|finish|error}]`, `current`, `direction`, always renders `<button>` with a numbered circle. No icons per status, no time meta, no read-only mode.
- `Layout/Header/Content/Footer` (`LIB/Layout/Layout.tsx:12-17`): static class strings (`Footer`: `border-t px-6 py-4`); no slots, no heights.
- `Segmented` (`LIB/Segmented/SegmentedPrimitive.tsx`): single-select rounded-full pill, text options (toolbar scope, T6; not needed here).
- `Tag` (`LIB/Tag/Tag.tsx`): pill, `color`, `closable`; no mono, no icon prop, no copy. `Badge`: default|secondary|destructive|outline. `Divider` with children renders rule-label-rule (`LIB/Divider/Divider.tsx:8-15`). `Input/Textarea`: field chrome, no trailing-action slot. `Tooltip`: Radix parts (`LIB/Tooltip/Tooltip.tsx`). `Popconfirm`, `Progress`, `Spin`, `Alert`, `Dropdown`, `Card` exist. `FloatButton`/`BackTop` are `position: fixed` (`FloatButton.tsx:9`): unusable for the Jump pill ("nothing floats", M5). `Message` is `window.alert` (`Message.tsx:9`).
- Storybook: `.storybook/main.ts:12` globs `.storybook/**/*.stories.tsx` and `packages/core/src/**/*.stories.tsx`; aliases `@oc-tech/omni-ui-components` -> src (`main.ts:21-32`). The Overview pages (`.storybook/getting-started/ComponentOverview.stories.tsx`, 1076 lines) import components + `factories/omni-ui-components/X/X.factories` and render rows with `<Row>`, `VariantLinks`, `CodePanel`. Showcases live as `packages/core/src/Table/Showcase/*.stories.tsx` (title `omni-ui-components/Table/Showcase/Team roster`) wrapped by `ShowcaseShell.tsx` (scenario text + live component + Show code). `packages/core/src/showcase/entities.ts` holds shared fixture data.

## 1. Proposed library change set (the answer in one view)

Rule applied: a new prop on an existing component before a new component. Three genuinely new components; everything else is variation.

| # | Item | Kind | Used by |
|---|---|---|---|
| L1 | `Button`: `tone` (default\|danger\|success\|warning\|info), `buttonSize` `control` (36px token), `loading`, `pressed`, `shortcut` (kbd text), `fillIcon`, real `asChild`, `variant` gains `soft` (muted fill) | VARIATION | M3 Stop, M6 Apply/Clear/Add, F3, F4, M9 pill, empty-state action |
| L2 | `IconButton`: `tone`, `pressed`, `activeTone`, `badge`, `size` `control` | VARIATION | M7/M8 mic+send, copy button M1, toolbar later |
| L3 | `Empty`: `variant: 'tile'` (no border), `icon`, `title`, `action` | VARIATION | M7 empty states |
| L4 | `Steps`: `variant: 'checklist'`, per-status icons, `item.meta`, `readOnly`, no `onChange` -> `<li>` not `<button>` | VARIATION | M3 |
| L5 | `Tag`: `mono`, `icon`, `copyText`/`onCopy`, `tooltip`, `size sm` | VARIATION | F2 build tag, event chip option |
| L6 | `Panel` (header 40px: title, meta, actions; body; dock; `scroll` config: fadeTop, follow, jump pill, thin scrollbar) | NEW | M2, M4-M7, M9, M10 |
| L7 | `Transcript` (typed `items[]`: turn, message, event; copy, edited, select callbacks) | NEW | M1, M2 |
| L8 | `SessionBar` (footer): `start`/`center`/`end` slots, fixed height token, no tint; plus `StatusClock` sub-part (icon + mono timer + optional state label) | NEW (one component, one exported sub-part) | F1-F6 |
| L9 | `Composer` (input + trailing icon actions + submit) | NEW | M8 |
| L10 | Tokens + exported `useFollowLatest` hook (moved from `APP/panels/follow-latest.ts`) | TOKENS/HOOK | M9 |
| - | Code editor body (`read-only-code.tsx`, CodeMirror highlight, tests drawer) | CUSTOM-OMIT | Code panel body |

Four new components is one more than a pure-variation answer; L9 is the one to challenge (open question Q3).

## 2. Per-item audit (M1-M11)

Fields: (a) UI parts, (b) existing library match, (c) gap, (d) stories and showcase board, (e) tokens, (f) tests. Native "stays" = callbacks that must keep working.

### M1 Transcript content (speech turns, chat messages, capture event chips, edited flag, copy; no recording status)
- (a) Turn bubble (speaker label, time, text), message bubble (right aligned, no speaker), assistant answer lines, event chip line ("S1 · no question found · 08:33", icon), `edited` flag, copy button with "Copied" state, select-to-show on assistant rows.
- (b) `Divider` with children covers the event line (`Divider.tsx:8-15`). `IconButton` covers copy (L2). No chat bubble or log component exists.
- (c) NEW COMPONENT `Transcript`; why: no existing component renders typed chat items; a Variation of `List` (`List.tsx`) would be a rewrite. API:
```ts
type TranscriptItem =
  | { kind: 'turn'; id: string; speaker: string; tone?: 'success'|'info'|'accent'; time: string; text: string; edited?: boolean }
  | { kind: 'message'; id: string; time?: string; text: string; align?: 'end' }
  | { kind: 'answer'; id: string; time: string; label: string; lines: {kind:'text'|'heading'|'code'; text:string}[]; selected?: boolean; stage?: {label:string; since:number} }
  | { kind: 'event'; id: string; icon?: IconName; text: string };
interface TranscriptProps {
  items: TranscriptItem[];
  onSelect?: (id: string) => void;            // answer rows (today panel-views.tsx:130-144)
  onCopy?: (text: string, id: string) => Promise<boolean>;   // today CopyBubble, panel-views.tsx:99-123
  copyLabel?: (copied: boolean) => string;
  renderStage?: (stage) => ReactNode;         // keeps the ticking "Solutioning… 12s" in the repo
  copyPlacement?: 'header' | 'hover';
}
```
  M1 is mostly data: the repo must stop emitting the system line (`use-panel-session.ts:103`, rows built at `panel-model.ts:512`); the library only guarantees no `system` kind exists.
- (d) Stories: `Transcript` (Default, WithEvents, EditedAndCopied, SelectedAnswer, Empty) -> board "Panels / Ready", "Analysing", "Answer ready". Factories: `transcriptPropsFactory`, `transcriptVariants`.
- (e) Bubble fills use `--oui-bubble-turn`, `--oui-bubble-message`, `--oui-bubble-answer` (today hard-coded rgba, `panels.css` `.pn-row`), tone text colours from the tone tokens.
- (f) Renders each kind; no recording kind accepted (type-level + a runtime test that unknown kinds are dropped); copy shows "Copied" only after the promise resolves true; `onSelect` on Enter/Space; stopPropagation of copy click.

### M2 Remove header red dot
- (a) none (a deletion). (b) n/a. (c) NONE in the library: `Panel` header has no status-dot slot by design (title, meta, actions only); the repo deletes `.pn-dot` use in `panel-views.tsx:~240-250` (`data-testid="pn-rec"`) and its test. (d) covered by Transcript/Panel stories (header has no dot). (e) none. (f) a Panel test asserting header contains only title/meta/actions regions.

### M3 One place for progress: step list + Stop in Answer header
- (a) Checklist rows (done check, current ring/spinner, pending circle, elapsed time), header Stop button with shortcut.
- (b) `Steps` `LIB/Steps/Steps.tsx`; `Button` for Stop; `Spin` for the ring.
- (c) VARIATION L4 + L1:
```ts
// Steps
variant?: 'default' | 'checklist';
items: { key?; title; description?; status?; meta?: ReactNode; icon?: ReactNode }[];
readOnly?: boolean;                       // renders <li role="status"> rows, no button
// Button
shortcut?: string;                        // <kbd> after label, mono
```
  Stop = `<Button variant="outline" tone="default" buttonSize="sm" icon={<StopCircle/>} shortcut="⌘⇧S" onClick={onStop}>Stop</Button>` passed through `Panel.actions`. Repo keeps `answerSteps()` (`toolbar-config.ts:440`) and `useElapsed` as the data source.
- (d) Stories `Steps/Checklist`, `Button/WithShortcut`; board "Panels / Analysing". (e) `--oui-tone-success-fg` (done), `--oui-tone-info-fg` (current), `--oui-foreground-muted` (pending). (f) status->icon map for done/current/pending; readOnly renders no button; Stop onClick fires; shortcut text rendered.

### M4 "No question found" in header meta
- (a) right aligned meta text in the header. (b) none needed. (c) NONE once `Panel` exists: `meta` slot. The repo moves `s.noQuestionLine` (`answer-pane.tsx:~117`, `data-testid="pn-no-question"`) into `meta`. (d) board "Panels / Ready". (e) `--oui-panel-meta-fg`. (f) meta is right aligned and truncates before the actions.

### M5 Nothing floats; flex column panel
- (a) Panel root (flex column), header 40px, body `flex:1; min-height:0; overflow:auto`, optional dock, empty-state action inside body.
- (b) `Layout` set (`Layout.tsx`) is the closest but is static. (c) NEW COMPONENT `Panel`; why: Layout sections cannot take title/meta/actions/dock config and Card adds shadcn padding rules. API:
```ts
interface PanelProps {
  title: ReactNode;
  meta?: ReactNode;                       // right aligned, muted
  actions?: ReactNode | ActionSpec[];     // ActionSpec = {id; label; icon?; tone?; shortcut?; onClick; disabled?}
  dock?: ReactNode;                       // bottom, only rendered when truthy (M6)
  dockPlacement?: 'bottom';               // reserved, only value used
  scroll?: false | { fadeTop?: boolean; follow?: { lines: number; activity?: unknown }; jumpLabel?: (unseen: number) => string; onJump?: () => void };
  bodyPadding?: 'none' | 'md';
  children: ReactNode;
  'data-testid'?: string;
}
```
  Nothing in `Panel` uses `position: absolute/fixed` against the window; the Jump pill is `position: sticky` inside the body (as today `panels.css:714`). Drops `Layout`'s `px-6 py-4`.
- (d) `Panel` stories: Default, WithMetaAndAction, WithDock, EmptyBody, Scrolling; boards all three. (e) `--oui-panel-header-height: 40px`, `--oui-panel-radius`, `--oui-panel-pad`, `--oui-panel-border`. (f) header height token, body overflow auto, dock renders only when given, no absolute positioning in computed styles (jsdom: assert no `absolute|fixed` class in the tree).

### M6 "To apply" dock
- (a) Dock row: count label, thumbnails, "Add screenshot" dashed button, "Clear" link, primary "Apply".
- (b) `Panel.dock` slot (L6), `Button`, `Tag`/`Image` for thumbs. Current implementation is `APP/../shared/screenshots-area.tsx:~350-420` (`ScreenshotsArea`, class `ss-*`; also has intent radios, per-task stored strip, "sends" text, error rows), shared with web.
- (c) VARIATION: Panel `dock` slot only; the content is CUSTOM-OMIT for the library (`ScreenshotsArea` stays in this repo, rendered into `dock`; needs its `native` variant restyled to a single 48px-max row; the intent radios and error lines move into the body above the dock or a popover). The showcase composes the dock with `Flex` + `Button` + 52x32 thumbnail `div` from a config object. Button additions: `variant: 'outline'` with `tone` plus a dashed border option `borderStyle?: 'solid' | 'dashed'`.
- (d) `Panel/WithDock`; board "Panels / Analysing". (e) `--oui-panel-dock-bg`, `--oui-panel-dock-pad`, `--oui-panel-dock-gap`. (f) dock absent when `dock` is null; stays inside panel bounds; Apply/Clear callbacks fire.

### M7 Panel chrome and empty states
- (a) Header (title, meta, action), 40px icon tile, optional title, one line, optional action.
- (b) `Empty` (`Empty.tsx`): dashed box, 32px inbox icon. (c) VARIATION L3:
```ts
interface EmptyProps {
  variant?: 'dashed' | 'tile';       // 'tile' = no border, no min-h-48, flex:1 centred
  icon?: ReactNode;                  // rendered in a 40px tile (token)
  title?: ReactNode;
  description?: ReactNode;           // "Starts automatically after the approach."
  action?: ReactNode | ActionSpec;   // empty-state Capture button, inside the body
  maxWidth?: number;
}
```
  Repo mapping: `.pn-empty` (`panels.css:1313-1344`, 44px tile today -> 40px), Code placeholder `pn-placeholder` (`answer-pane.tsx:~385`, bare `Icon name="code"`).
- (d) `Empty/Tile`, `Empty/TileWithAction`, `Empty/CodeWaiting`; boards Ready, Analysing. (e) `--oui-empty-tile-size: 40px`, `--oui-empty-tile-bg`, `--oui-empty-icon-fg`. (f) tile 40px, title optional, action rendered inside body, dashed variant unchanged (existing `Empty` test keeps passing).

### M8 Composer: neutral mic (red while dictating), muted send until text
- (a) Input, mic toggle, send.
- (b) `IconButton` (L2) and `Input/InputPrimitive` (`Input.types.ts:12`, no trailing slot).
- (c) NEW COMPONENT `Composer` (justification: Input has no action slot and the follow-up form exists twice in this repo: `panel-views.tsx:~262-290` and `overlay-footer.tsx:FollowUp`); API:
```ts
interface ComposerProps {
  value: string; onChange(v: string): void;
  onSubmit(text: string): void | Promise<{ ok: boolean }>;   // clears only if ok (current submit logic, panel-views.tsx:~205)
  placeholder?: string; disabled?: boolean; interim?: string;
  actions?: { id: 'mic'|string; icon: ReactNode; label: string; pressed?: boolean; tone?: 'danger'; onClick(): void; disabled?: boolean }[];
  submitIcon?: ReactNode; submitLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
}
```
  Send is muted by `variant: 'soft'` while `value.trim()===''`, accent after. Mic: `pressed` + `tone="danger"` only while dictating (`s.live.mic === "listening"`).
- (d) `Composer` stories Empty, WithText, Dictating, Disabled; boards all three. (e) `--oui-control-height`, `--oui-tone-danger-*`. (f) send disabled/muted until text; mic neutral when not pressed, danger when pressed; Enter submits; value kept on failed send.

### M9 Scrolling
- (a) 28px top fade mask, thin overlay scrollbar, stick-to-bottom, "Jump to latest" pill with unseen count.
- (b) none. Behaviour exists: `APP/panels/follow-latest.ts` (`useFollowLatest`: `AT_END_PX=48`, person-scroll detection) and `.pn-jump` (`panels.css:714-732`). (c) VARIATION on `Panel.scroll` (above) plus the hook moved into the library unchanged and exported (L10); mask and scrollbar are CSS: `mask-image: linear-gradient(to bottom, transparent 0, #000 var(--oui-scroll-fade))`, `scrollbar-width: thin`, `scrollbar-color`. The repo's `ChatPanel` currently wires `log.ref/onScroll/onWheel/onTouchMove/onPointerDown/onKeyDown` by hand (`panel-views.tsx:~232-240`); `Panel.scroll.follow` owns that.
- (d) `Panel/Scrolling` (many rows + jump pill), board "Panels / Analysing" (gallery shows mask). (e) `--oui-scroll-fade: 28px`, `--oui-scrollbar-size: 6px`, `--oui-scrollbar-thumb`. (f) port `follow-latest.test.ts` as is; pill appears when not following; label `N new`; mask style present.

### M10 Reflow
- (a) Row layout: transcript 330 (min 300), others `flex: 1 1 0`, footer full width.
- (b) `Splitter` (`Splitter.tsx`) is only `flex-basis` + `divide-x` with no min widths. (c) VARIATION: `Panel.width?: { basis: number; min?: number } | 'fill'` applied as `flex: 0 0 basis; min-width`; the row is a plain `Flex` in the showcase and `.pn-single-body` in the repo. Repo changes: replace the hard-coded `flex: 0 0 320px` / `1 1 480px` / `0 1 420px` (`panels.css:565-650`) with 330/min 300 and equal `1 1 0` for the rest; footer remains a sibling row (`single-panel.tsx` renders `.pn-single-foot` after `.pn-single-body`), so it already spans the row once the banner/strip are gone. The shell's width table `windowWidthFor` (`toolbar-config.ts`) must be updated to the new 330 min 300 numbers.
- (d) Showcase boards "Panels / three states" at 900, 1180 and with Code hidden. (e) `--oui-panel-width-chat: 330px`, `--oui-panel-width-min: 300px`. (f) Layout test at widths 900/1180: no horizontal overflow in the row; this is a repo test (`panels-css.test.ts`, `layout-rules.test.ts`), not a jsdom library test.

### M11 See-through on backgrounds only
- (a) none (token behaviour). (b) n/a. Repo already tints via glass tokens only (`panels.css:1586-1599` overrides `--pn-glass*`, not element opacity), but some controls use `opacity` (`.pn-copy`, `.pn-round:disabled`, `panels.css:1424-1445,504`) which fades text in clear mode only through hover/disabled, not see-through. (c) VARIATION (tokens): library defines `--oui-panel-bg: color-mix(in srgb, var(--oui-panel-bg-base) calc(var(--oui-see-through, 1) * 100%), transparent)`; panels/dock/footer use it; no component sets `opacity` for see-through. The repo maps `--oui-see-through` from `data-glass`. (d) Showcase control "See-through" 100/60/22%. (e) `--oui-see-through`, `--oui-panel-bg-base`, `--oui-panel-text-bed` (min reading tint from `panels.css` comment "Reading beds"). (f) computed style test: text colour alpha stays 1 when the token changes (repo-side, `panel-glass.test.tsx`).

## 3. Per-item audit (F1-F6)

### F1 Record icon + timer; paused amber state
- (a) Filled record icon (red) / pause icon (amber), mono timer, "Paused" label. (b) none (`Statistic` is a card). (c) NEW COMPONENT, but only one sub-part of `SessionBar`: `StatusClock`:
```ts
interface StatusClockProps {
  value: string;                         // "2:18:20" (use-elapsed / model.elapsedLabel)
  state: 'live' | 'paused';
  icons?: { live: ReactNode; paused: ReactNode };
  label?: string;                        // "Paused", shown only when state !== 'live'
}
```
  Colours come from `tone` tokens by state (live danger, paused warning); nothing else changes colour. Repo today: `ov-clock` + `ov-clock-dot` + the left-side warn notice (`overlay-footer.tsx:~212-240`).
- (d) `StatusClock` stories Live, Paused; boards Footer 1e rows. (e) `--oui-clock-font` (mono), `--oui-tone-danger-fg`, `--oui-tone-warning-fg`. (f) `role="timer"` with aria-label including ", paused"; label only when paused.

### F2 Dev-only build tag
- (a) mono pill `<short sha> · <branch>`, divider before it, tooltip full SHA, click copies. (b) `Tag` (L5) + `TooltipRootProvider/TooltipPopup`. (c) VARIATION L5:
```ts
Tag props: mono?: boolean; icon?: ReactNode; size?: 'sm'|'default'; tooltip?: ReactNode; copyText?: string; onCopied?: (ok: boolean) => void;
```
  Hidden-in-production is data, not a prop: the repo passes no `build` item. The repo needs the data: `BUILD_ID` today is only a short commit with "+" (`APP/build-id.ts`, set in `apps/web/next.config.ts:56`); it must also carry the full SHA and branch for dev builds, and `app.isPackaged` is a native signal (`PresentationHost`), so the web build env should expose `NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_BUILD_BRANCH` and the shell tells the page whether it is packaged (open question Q5).
- (d) `Tag/BuildTag`; board Footer. (e) `--oui-tag-mono-bg`. (f) clipboard called with the full SHA; tooltip text; `copyText` absent renders no button role.

### F3 One Resume / one primary action
- (a) Pause (outline, filled pause icon) <-> Resume (green filled, filled play icon). (b) `Button`. (c) VARIATION L1: Pause = `variant="outline" fillIcon`, Resume = `variant="default" tone="success" fillIcon`. Data already exists: `footerButtons()` returns `{id,label,title,icon,tone,disabled}` (`toolbar-config.ts:344-399`); map `tone: "go"` -> `success`, `"danger"` -> `danger`, `"default"` -> neutral. The paused strip banner deletion is repo-only (`single-panel.tsx` strip `state:null` branch, `status-strip.tsx` resume button, `PAUSED_NOTICE`).
- (d) `Button/ToneMatrix`, `Button/Success`; board Footer. (e) `--oui-tone-success-{bg,fg,border}`, `--oui-control-height: 36px`, radius 9px. (f) tone x variant matrix `data-tone`; fillIcon sets icon fill attribute.

### F4 Outlined red End with existing confirmation
- (a) outline danger button; confirm row. (b) `Button`; `Popconfirm` (`LIB/Popconfirm`) exists. (c) VARIATION L1 `variant="outline" tone="danger"`. The current confirmation is an inline `role="alertdialog"` row inside the footer with focus management (`overlay-footer.tsx:~255-300`); keep it: `SessionBar` gets `below?: ReactNode`. No attempt to swap to `Popconfirm` (Radix popover would float; M5/F5).
- (d) `Button/OutlineDanger`; board Footer. (e) `--oui-tone-danger-*`. (f) outline danger has border colour from token and transparent bg; confirm stays a repo test (`single-panel.test.tsx`).

### F5 Nothing floats in the footer
- (a) footer owns only its items. (b) n/a. (c) NONE in library beyond `SessionBar` having no positioned children; the repo guarantees via M5/M6. Add a repo layout test that no `.pn-single-foot` descendant is absolutely positioned and `.pn-single-foot` is a sibling after `.pn-single-body` spanning its width. (d)(e) none. (f) as stated.

### F6 No tint on pause
- (a) none. (b) n/a. (c) NONE/tokens: delete `.pn-single-foot:has(.ov-footer[data-notice="warn"])` (`panels.css:588-590`), `--pn-warn-bg`, `--pn-warn-bg-clear` (`panels.css:20-21`) and the clear-mode twin (`panels.css:1605-1607`); `SessionBar` background token never reads `state`. (d) Footer rows Live vs Paused identical bg. (e) `--oui-footer-bg` single value. (f) computed bg identical across `state` live/paused (library) plus repo `panels-css.test.ts` asserting the warn rules are gone.

### SessionBar (container for F1-F6)
```ts
interface SessionBarProps {
  start?: ReactNode;      // StatusClock
  center?: ReactNode;     // build Tag (after a 1x20 divider)
  end?: ReactNode | ActionSpec[];   // Pause/Resume, End
  below?: ReactNode;      // inline confirmation
  height?: number | 'control';      // token --oui-footer-height: 52px
  divider?: boolean;
}
```
Why not `Layout.Footer`: static `border-t px-6 py-4`, no slots (`Layout.tsx:17`). Why a component and not `Flex`: fixed 52px height, 9px/14px padding, 20px dividers and a no-tint guarantee are the contract.

## 4. Consolidated, de-duplicated table (ranked by reuse)

| Rank | Component / variation | Items that need it | Library change |
|---|---|---|---|
| 1 | `Button` tone/control size/shortcut/loading/pressed/soft/asChild fix | M3, M6, M8, M9, F3, F4, empty action (+toolbar T-series) | VARIATION |
| 2 | Tone + panel + control tokens | M5, M6, M7, M9, M10, M11, F1, F3, F4, F6 | TOKENS |
| 3 | `Panel` | M2, M4, M5, M6, M7, M9, M10 | NEW |
| 4 | `IconButton` tone/pressed/badge | M1 copy, M8, toolbar | VARIATION |
| 5 | `Empty` tile variant | M7 (x3 panels) | VARIATION |
| 6 | `SessionBar` + `StatusClock` | F1-F6 | NEW |
| 7 | `Tag` mono/copy/tooltip | F2, event chip option | VARIATION |
| 8 | `Transcript` | M1, M2 | NEW |
| 9 | `Steps` checklist | M3 | VARIATION |
| 10 | `Composer` | M8 (+ overlay FollowUp) | NEW |
| 11 | `useFollowLatest` hook | M9 | HOOK |
| - | Code body, tests drawer, screenshots area content | Code panel, M6 content | CUSTOM-OMIT (stay in repo) |

## 5. Implementation slice order

Library first (each slice: types, variants, story, factory, test, `ComponentOverview` row, `pnpm verify` in the library).
1. Tokens (`--oui-panel-*`, tone, control height, scroll, see-through, footer, clock) in `LIB/styles/tokens.css`; fix `Button` `asChild`; add `tone`, `control` size, `shortcut`, `loading`, `pressed`, `soft`, `fillIcon`; `IconButton` same props.
2. `Empty` tile, `Steps` checklist, `Tag` mono/copy.
3. `Panel` + exported `useFollowLatest`.
4. `Transcript`, `Composer`.
5. `SessionBar` + `StatusClock`.
6. Native App showcase (section 6), then publish a new version of `@oc-tech/omni-ui-components` (`package.json` script `publish:package`).
This repo adopts afterwards: (A) dependency bump and adapter (section 7); (B) footer first (small, F1-F6, closes the owner's ON HOLD Slice 2); (C) Answer/Code panels M3-M7; (D) transcript/composer M1, M2, M8, M9; (E) reflow M10 and see-through M11 (CSS and the shell width table).

## 6. Native App showcase outline

Location: `LIB/Showcase/NativeApp/` (new folder; `Table/Showcase` is Table-specific), files `NativeApp.stories.tsx`, `NativeApp.fixtures.ts` (pure config objects: transcript items, steps, dock config, footer config), `NativeAppShell.tsx` (reuses the `ShowcaseShell` idea: scenario header + stage + Show code). Story title `omni-ui-components/Showcase/Native App`; add the prefix to `VariantLinks.tsx:30` filter and to `storySort` in `.storybook/preview.tsx` (after Getting Started). Stage background `--oui-showcase-blue` (gallery uses #1a4f96 behind the panels) with the glass tokens applied so see-through is visible.

Stories (one per gallery board; each composes ONLY library components from fixture config):
- `Panels / Ready` (1d state 1: Transcript with turns + event chip, Answer `Empty` tile with Capture action and meta "Last capture 08:33 · no question found", Code `Empty` tile "Code appears once the approach is drafted").
- `Panels / Analysing` (1d state 2: Answer header Stop button, `Steps checklist`, dock "To apply 1", Code `Empty` hourglass "Starts automatically after the approach.", transcript with fade mask and message bubble).
- `Panels / Answer ready, Code hidden` (two panels reflow; header meta chips O(n) time/space).
- `Footer / Live dev`, `Footer / Live production`, `Footer / Paused dev` (gallery 1e), plus `Footer / With sensor icons` only if the owner keeps 1f (Q4).
- Controls: Storybook `args` for `seeThrough` (100/60/22), `width` (900/1180), `paused`, `devBuild`.
Callbacks mocked with Storybook actions: fixtures export `handlers = { onStop, onApply, onClear, onAddScreenshot, onSend, onToggleMic, onPauseResume, onEnd, onCopy, onSelect, onJump }`; stories wire them with `action('...')` from `storybook/actions` (or `argTypes: { onStop: { action: 'stop' } }` as `Button.stories.tsx:15` does). The `Composer`/`Transcript` stories use a tiny controlled wrapper (like `Controlled` in `ComponentOverview.stories.tsx:~250`) so typing and dictating toggle visibly.
Documentation: add a "Native App" row group to `ComponentOverview.stories.tsx` (rows for Panel, Transcript, Composer, SessionBar, Empty tile, Steps checklist) and the `Variant[]` factories per component as in `Button.factories.tsx`. Show-code panel prints the config object, so the same config is what the repo passes.

## 7. How this repo consumes the library

Today: `apps/web/package.json:17` and root `package.json:58` pin a vendored tarball `vendor/omni-ui-components/oc-tech-omni-ui-components-0.0.2.tgz`; only `apps/web/app/layout.tsx:5` imports `@oc-tech/omni-ui-components/styles.css`; no component is imported. `products/interview/src/frontend/ui/` (Slice 1) has `button.tsx`, `ui.css`, `tokens.css` (`--ui-*`), `index.ts` as its only import path.
Plan:
1. Replace the tarball with a published `@oc-tech/omni-ui-components` version (or a `link:` for local development) and import components from `@oc-tech/omni-ui-components` inside `ui/` only. Dependency addition needs the scope checkpoint (ADR-0002) and possibly an ADR: the Phase 2 decision "no new dependency" is superseded by the owner's "same components" direction.
2. `ui/` becomes a thin adapter: `ui/index.ts` re-exports library components with repo defaults (e.g. `Button` with `buttonSize="control"`), and `ui/tokens.css` maps `--oui-*` from `--ui-*`/`--pn-*`/`--ov-*` per surface scope (Studio, overlay, `.pn-root`, clear glass) exactly as Slice 1 maps `--ui-*` today. `ui/button.tsx` and `ui.css` are deleted once the library `Button` covers variants `go`-> `tone="success"`, `glass` -> a `--oui-*` scope mapping, `loading`, `pressed` (the Slice 1 `BUTTON_VARIANTS` table becomes the acceptance test list).
3. Products still import only `../ui` (one entrypoint, ADR-0003); nothing imports library paths directly.
4. Native hit-region/drag rules key off classes (`.pn-pill`, `.pn-single-foot`, `HIT_SELECTORS`, `hit-regions.ts`): library components must emit stable `data-slot` hooks (`panel`, `session-bar`, `transcript`) and `HIT_SELECTORS`/`WindowDrag` are updated in the same slice as each adoption (existing rule in plan.md constraints).
5. Risks to check on the first spike: Tailwind utilities in `dist/styles.css` vs this app's plain CSS (the library imports Tailwind theme + utilities only, `tailwind.css:1-3`; confirm no preflight reset leaks), `@layer omni-ui-components` cascade vs `panels.css` specificity (Slice 4 lesson: after migrating, read computed colours in the browser), React peer range `^18.3.1 || ^19` vs the repo's catalog, and bundle growth in the native WebView.

## 8. Open questions for the owner

1. Four new library components (`Panel`, `Transcript`, `Composer`, `SessionBar`): accept, or fold `Composer` into `Input` (trailing `actions` slot) and `SessionBar` into `Layout.Footer`?
2. Naming and token prefix: library `--oui-*` stays; the repo adapter maps `--ui-*` onto it. OK, or rename the repo's tokens?
3. `Button` is the biggest churn (new `tone` prop, 36px `control` size, `buttonSize` naming that the repo's `size` differs from). Rename `buttonSize` to `size` in the library (breaking, DOM `size` clash is on `<input>` not `<button>`) or keep the adapter translation?
4. Gallery board 1f (footer with sensor icons) is marked as use-only-if-toolbar-has-no-badges: drop it from the showcase and library?
5. Dev build tag data: may the build expose full SHA and branch via `NEXT_PUBLIC_BUILD_*`, and who supplies "is packaged" to the page (`PresentationHost`) given `BUILD_ID` today is a short SHA only?
6. Library publish path: npm `@oc-tech` publish and re-vendor the tarball, or a workspace/`link:` during development? The repo cannot be verified against unreleased components otherwise.
7. Screenshots tray content (`ScreenshotsArea`) is shared with the web Studio and has intent radios and failure rows the gallery does not show. Where do the radios and "sends" text go when the dock is one row?
8. M2 and M1 delete behaviour (the Recording dot and the recording system line) that tests assert (`pn-rec`, `single-panel.test.tsx`, `strip-model.test.ts`): update those tests as part of the same slice?
