# Audit B: non-button web UI primitives

Read-only audit, 2026-10-06. Scope: React in `products/interview/src/frontend` (S/ below = `products/interview/src/frontend/studio/`), `products/presentation/src/frontend` (P/), `apps/web`, `packages/*` (no package has React UI). All line numbers are as of master `bb5ab77`. Buttons are out of scope (Worker A).

## 0. Headline findings
- There is almost no shared UI code. The only shared React primitives are `Icon` (S/icon.tsx), `Dialog` (S/shared/dialog.tsx, 4 callers), `Popover` (S/live/overlay/panels/popover.tsx, 6 callers) and `RevisionsControl` (S/live/shared/revisions-control.tsx). There is no `components/` or `ui/` folder anywhere in `src`. The two `shared/` folders (S/shared, S/live/shared) hold hooks and domain widgets, not a kit.
- `@oc-tech/omni-ui-components` 0.0.2 is vendored and listed in `package.json:58` and `apps/web/package.json:17`, but the only import is its CSS (`apps/web/app/layout.tsx:5`). No component of it is used. The Studio token file only mentions it in comments (S/tokens.css:15, :75).
- Every family is drawn once per surface with a surface prefix: 9 chip/pill classes, 8 spinners, 10+ menus, 7 tab strips, 6 card families, 11 banner/notice classes, 7 toast/empty-state families. Surface prefixes are the real "component boundary" today.
- Form controls mostly carry no class at all. 44 `<input>` (22 files), 24 `<select>` (9 files), 18 `<textarea>` (12 files) are styled by 40+ descendant selectors (`.setup-card input`, `.bp-field input`, `.home-form input`, `.documents-view :is(button,input,select,textarea)` ...) in 12 CSS files. Presentation has 14 selects and 10 inputs without a class (P/index.tsx:362-2386).

## 1. Inventory by primitive
Columns: file:line (CSS rule line unless noted) | classes | purpose | variants | states | duplicates.

### Text inputs / textarea / select / checkbox / radio / switch
| Where | Classes | Notes |
|---|---|---|
| S/documents/new-document-dialog.tsx:496,506 / template-library.tsx:554 / documents.css:301 | `dx-input`, `dx-textarea` (:333,532,573), `dx-select` (:313; tsx new-document-dialog.tsx:572), `dx-field-input` (document-editor.tsx:962; css :518) | Only classed form controls in Studio; two input classes inside one view |
| S/live/overlay/overlay-footer.tsx:89 | `ov-input` (+`interim`) css overlay.css:913 | Card ask box |
| S/live/overlay/panels/panel-views.tsx:356,453,480 | `pn-input`, `pn-select` panels.css:271-272 | Native panel |
| S/live/overlay/settings-popover.tsx:59,79 | `ov-select` overlay.css:1253 | Card settings |
| S/live/setup-sections.tsx:279 | `setup-select` setup.css:393; inputs via `.setup-card input` setup.css:88 | Setup |
| S/rehearsal/rehearsal-view.tsx:273,288; live-session.tsx:159,185,196 | none / `rehearsal-code`; `.rehearsal-pickers select` rehearsal.css:105 | descendant only |
| S/home/interview-card.tsx:165-207; plan-card.tsx:146 | none; `.home-form input` home.css:99 | 6 inputs, no class |
| S/briefings/behavioural/* (setup-card 156/171, questions-card 47/73, briefing-tabs 359, answers-tab 250) | none; `.bp-field input` behavioural.css:266, `.bp-question-row input` :380, `.bp-ask input` :700, `.bp-edit textarea` :657 | 4 field rule sets |
| S/workspace/new-question.tsx:54,62; stage-panes.tsx:257 | none / `ws-scratchpad`; `.ws-new-card textarea` workspace.css:815 | |
| S/command-palette.tsx:49; library.tsx:443 | `.studio-palette-search input` tokens.css:629; `.library-search-wrap input` library.css:44 (+ knowledge.css:28) | two search boxes |
| P/index.tsx (14 select, 10 input, 5 textarea), slide-blocks.tsx:73,115 | `presentation-reference-*` (css:38,127,174,277,321,365,383,471,494,578,650) plus global `input,select,textarea` apps/web/app/styles.css:385-405 and `.studio-panel input` :506 | Separate dark-literal design |
| Checkbox/radio: briefing-tabs.tsx:413, matrix-picker.tsx:325, setup-sections.tsx:174, setup-view.tsx:241 (checkbox); setup-controls.tsx:151, screenshot-send-control.tsx:62, screenshots-area.tsx:382 (radio) | `.setup-consent input` setup.css:130, `.ss-radio input` screenshots.css:181, `.interview-preparation input[type=checkbox]` studio-base.css:481 | native inputs, per-view styling |
| Switch: S/live/setup-controls.tsx:113 `setup-switch` (setup.css:154); S/rehearsal/rehearsal-view.tsx:353 `rehearsal-switch` (rehearsal.css:112) | `role="switch"` button + `<span/>` thumb, `.on` class | exact duplicate, 2 implementations |
| Segmented / radiogroup: setup-controls.tsx:49 `setup-segmented/segment` (setup.css:197,204); documents-ui.tsx:77 `dx-segmented` (documents.css:119); hands-free-controls.tsx:435 `ov-segmented/segment` (live.css:144,151); panels/code-card.tsx:103 `pn-file-tabs/pn-file-tab` (panels.css:1831,1836) | 4 drawings of one toggle group; `.on` vs `aria-pressed` vs `aria-checked` differ |
| Card radio: setup-controls.tsx:149 `CardOption`, `setup-card` (setup.css:75) | native radio hidden over a card | |

States seen: focus ring is declared per surface (`.live-page ... :focus-visible` live.css:44, `.ov-card :is(...)` overlay.css:131, `.documents-view` documents.css:32, `.interview-preparation` studio-base.css:473, `--studio-focus` token).

### Popovers and menus
| Where | Classes | Dismiss/keys | Notes |
|---|---|---|---|
| S/live/overlay/panels/popover.tsx:36 `Popover` | `pn-popover` (class defined at session-view.css:446, not panels.css), panel `pn-menu`, `pn-menu-item/-label/-sub/-head/-narrow/-danger` (panels.css:973-1030, start-panel.css:69), `pn-display-menu` :1064, `pn-split-menu` :771, `pn-account-menu` start-panel.css:49 | `useDismiss`, Escape, Tab, Arrow keys, focus in/out, toolbar lock | the one real primitive; callers: toolbar.tsx:293,348,419, start-panel.tsx:290, screen-picker.tsx:152, revisions-control.tsx:80 |
| S/live/overlay/panels/window-dots.tsx:144,242,308,359 | `pn-menu` | own `useDismiss` x2 | reimplements Popover for window-mode menu |
| S/live/overlay/overlay-capture.tsx:292,340 | `ov-menu`, `ov-analyze-menu`, `ov-menu-item/-label/-sub/-note/-text/-new` (overlay.css:332-398) | `useDismiss` + own arrow nav (:185-197) | 10 `menuitem`s |
| S/live/overlay/session-switcher.tsx:77,132,163 | `ov-switcher*`, `ov-session-menu` (overlay.css:294-347) | own pointerdown + own arrow nav (:83-96) | |
| S/live/overlay/settings-popover.tsx:45-59; source-popover.tsx:20-27 | `ov-popover*` (overlay.css:1210-1229), `role="dialog"` | `useDismiss` | |
| S/account/account-menu.tsx:41,76,105 | `studio-account-menu` (account.css:53) | own pointerdown, own key nav (:32) | |
| S/home/plan-card.tsx:116,130,137; S/workspace/versions-menu.tsx:35,48,58 | `ws-versions-menu` (workspace.css:883) shared by two files | own mousedown each | same markup twice |
| S/briefings/behavioural/matrix-picker.tsx:89,112 | `bp-menu`, `bp-menu-rule` (behavioural.css:191,246) | own | |
| S/documents/document-editor.tsx:250,491-648 | `dx-menu` + `-export/-regen/-revs/-item/-title/-line/-model` (documents.css:375-458) | own window mousedown | 3 menus in one file |
| Revisions list | `ov-rev-menu` (overlay.css:1769), `live-rev-menu` (session-view.css:450), `pn-menu pn-menu-narrow` | via `RevisionsControl` VARIANT map (revisions-control.tsx:13-40) | one component, three class sets |
| P/presentation.css:44 | `presentation-reference-menu` | | |

Outside-click is implemented 7 ways (`useDismiss` at S/live/overlay/use-dismiss.ts:7 used 8 times; own listeners at account-menu.tsx:41, plan-card.tsx:116, versions-menu.tsx:35, document-editor.tsx:250, document-preview.tsx:147, session-switcher.tsx:77). Arrow-key navigation is implemented 4 times (popover.tsx:62, overlay-capture.tsx:185, session-switcher.tsx:83, account-menu.tsx:32).

### Chips, pills, badges, dots
`live-chip` + tone `green|amber|red|neutral|accent` (live.css:102-121; used in ~40 places: session-bar.tsx:176-217, claim-chips.tsx:48,59, coding-panel.tsx:68,196,289 ...) is the widest chip; also `live-chip-button` (live.css:35, a chip that is a button). Others, each its own: `ov-chip` (overlay.css:284), `pn-chip` (start-panel.css:22), `bp-chip` (+`.green` behavioural.css:825,836), `dx-chip` (documents.css:170; lg/note :179,181), `home-chip` (home.css:53), `pn-task-chip` (panels.css:1232; status-strip.tsx:98), `pn-type-pill` (:685), `pn-mini-pill` (:1656), `ov-pill` (overlay.css:630), `dx-pill` (documents.css:155), `ws-pill` (workspace.css:100), `presentation-reference-pill` (presentation.css:306). Badges: `bp-badge` (:104), `ss-badge` (screenshots.css:63), `ws-badge` (workspace.css:664; reused in two tab strips). Dots: 18 `*-dot` classes (e.g. `live-dot` live.css:51, `studio-dot` tokens.css:298, `pn-dot` panels.css:227, `ov-dot` overlay.css:188).
Note `.pn-pill` (overlay.css:1716 region, the toolbar) is NOT a chip: it is the native toolbar container, and is in the hit-region and drag lists.

### Cards / panels / sections
`setup-card` (setup.css:75), `bp-card` (+head/foot, behavioural.css:130; 14 uses in briefing-tabs.tsx), `dx-card` (documents.css:183), `home-card` (home.css:8), `rehearsal-card` (rehearsal.css:313), `library-card` (knowledge.css:92), `ov-card` (overlay.css:6, this is the floating card), `pn-card` (panels, native pane), `pn-codecard`, `pn-mini-card`, `pn-start-card`, `auth-card` (styles.css:106), `presentation-reference-card` (presentation.css:40), `ws-new-card`, `ws-example-card`, `studio-theme-card`. Each defines its own border/radius/padding/bg; no common `Card`. Page chrome: `studio-page/-page-inner/-page-head` (tokens.css:497-525), `studio-header` (:388), `studio-section-label` (:269).

### Tabs / toggle groups
7 tablist implementations: S/workspace/code-panel.tsx:177 `ws-file`, :238 `ws-panel-tab`; S/live/session-tabs.tsx:53 `live-tab` (roving tabindex + arrows, aria-controls); S/live/coding-panel.tsx:137 `live-coding-tab` (roving + arrows); S/live/overlay/code-canvas.tsx:319,419 `lc-tab` (no roving); S/briefings/behavioural/behavioural-pack.tsx:566 `bp-tab-list`; P/presentation.css:49 `presentation-reference-tabs`. Plus the native `pn-file-tab` group using `role="group"`. Only 2 of 7 follow the tabs keyboard contract. Pane toggles: `pn-bar-button pn-icon-button` + `aria-pressed` (toolbar.tsx:407). Task chips: `pn-task-chips` (status-strip.tsx:93).

### Banners, notices, strips, toasts
Banner/notice: `live-banner` (red/amber via role alert/status, session-banner-list.tsx:42; css session-view.css:49), `live-notice` (session-view.css:110; coding-panel.tsx:234,278, answer-body.tsx:122, run-notices.tsx:141), `live-bar-notice` (session-bar.css:160), `auth-banner-info/-warn` (styles.css:174-198), `dx-banner` (documents.css:479), `dx-notice` (:59), `rehearsal-banner` (rehearsal.css:211), `assistant-change-banner` (workspace.css:584), `pn-start-banner` (start-panel.css:137; 4 uses), `pn-display-notice` (panels.css:1089), `cp` capture-problem (capture-problem-banner.tsx:27; capture-problem.css), `missing-context-strip`, `device-only-notice`. Strips: `pn-strip` (panels.css:588; status-strip.tsx:63), `ss-strip` (screenshots.css:80). Toasts: `dx-toast` (documents-ui.tsx:165), `live-toast` (live-session-view.tsx:323), `pn-toast(s)` (panel-views.tsx:516-525), `pn-start-toast` (start-panel.tsx:238). Tone vocabulary differs: `red|amber|green|neutral|accent` (live) vs `info|warn` (auth) vs `preview|applied` (assistant) vs `ok|warn|bad|danger` tokens (panels).

### Tooltips, titles
No tooltip component or `role="tooltip"`. 56 `title=` attributes in 30 files; one custom hint `ws-tip` (stage-panes.tsx:264, workspace.css:435). Toolbar triggers push the lock reason into `title` (popover.tsx:93).

### Dialogs / confirmations
`Dialog` (S/shared/dialog.tsx:5; callers documents-ui.tsx:138, command-palette.tsx:41, matrix-picker.tsx:238, each with a different scrim class `dx-scrim`, `studio-palette-scrim`, `bp-scrim`). Not using it: sign-out-dialog.tsx:80 (`studio-modal-scrim`), end-confirm.tsx:59 (`live-end-scrim`), image-viewer.tsx:172 (`ss-viewer-scrim`), mask-editor.tsx:207, `pn-single-confirm` inline confirm. Four hand-built `aria-modal` dialogs against one shared.

### Icon wrapper
`Icon` S/icon.tsx:9: Material Symbols as generated SVG paths (`icons.generated.ts`), `name`, `filled`, `size`, `style`; `.studio-icon` class (tokens.css:130). 356 uses in 80 files, always via `S/icon`; the `auto_awesome` special case delegates to `@omnitech-assistant/react`. Single-sourced, but only the interview product uses it; Presentation draws text glyphs/none.

### Spinners, empty states, skeletons
Spinners (8): `dx-spinner` documents.css:67, `ws-spinner` workspace.css:679, `bp-spinner` behavioural.css:552, `ov-spinner` overlay.css:713, `pn-spinner` panels.css:1252, `pn-start-spinner` start-panel.css:275, `live-spin` session-view.css:295, plus 8 `@keyframes *-spin`. Same ring, different size, colour and thickness. Skeletons: none. Empty states: `live-empty` (session-tabs.css:50), `ov-empty` (overlay.css:57), `pn-empty` (+icon/title/sub, panels.css:1301-1328), `home-empty`, `briefings-empty`, `bp-empty`, `sd-empty` (+body/title/text, workspace-handoff.css:12-76), `dx-empty-row`, `studio-list-empty`, `studio-palette-empty`, `ws-code-empty`, `ss-thumb-empty`, `presentation-reference-empty`.

### Layout containers / headers
No Stack/Row/Page primitives. Page: `studio-page(-inner/-head)`; per-view heads: `home-card-head`, `bp-card-head`, `rehearsal-card-head`, `setup-card-head`, `library-card-head`, `pn-menu-head`, `ov-popover-head`. Labels: `studio-section-label`, `pn-menu-label`, `ov-menu-label`.

## 2. Drawn more than one way vs single-sourced
Single-sourced: `Icon` (356 uses); `Dialog` behaviour (but 4 modals bypass it); `Popover` behaviour in the native panel; `RevisionsControl` logic (class variants by prop); `useDismiss`; `CaptureProblemBanner` (one banner for 3 surfaces).
Multiple ways (counts above): switch (2), segmented (4), tabs (7), chip (9+3 badges), spinner (8), card (15), banner/notice (11), toast (4), empty (13), menu (10+), outside-click (7), arrow-key menu nav (4), modal (5), text field (12 CSS rule sets, mostly unclassed), search box (3), dot (18).

## 3. Naming and organisation
- Prefixes and owners: `pn-` (441 selectors; native panel, panels.css 1877 lines + start-panel.css), `ov-` (313; card/web overlay, overlay.css 1815), `live-` (213; web live session: live.css, session-*.css, ended.css, setup.css), `studio-` (215; shell, tokens.css 732, studio-base.css), `dx-` (documents), `bp-` (behavioural pack, 1148 lines), `ws-` (workspace), `ss-` (screenshots), `lc-` (code canvas), `sd-`, `cp`, `auth-`, `presentation-reference-`. Prefix = surface, not component. `.pn-pill` is defined in overlay.css:1716 and `pn-popover` in session-view.css:446, i.e. a native class lives in a web file.
- CSS ownership: `tokens.css` is a barrel (@import lines 1-11) plus Studio tokens (:19-97) and shell styles; `live.css` imports 10 sheets (live.css:5-14); `panels.css` imports start-panel.css:6; `apps/web/app/layout.tsx:5-9` imports omni-ui, assistant, styles.css, studio.css, presentation.css. 14,650 CSS lines across 27 files.
- Three token systems: (a) Studio `--app --surface --border --text --muted --accent --green --red --amber --pop` etc., oklch, light and dark, scoped to `.studio-app .oa-host` (tokens.css:19-77); aliases `--ink --line --paper --color-primary` (:80-92) and a second alias set in apps/web/app/styles.css:1-9 that point the other way. (b) Overlay `--ov-*` (24 vars, rgba/hex, dark-only) declared on `.ov-card,.ov-root,.ov-sheet` (overlay.css:8-30). (c) Panel `--pn-*` (62 vars incl. z-scale, glass, blur, ok/warn/bad/danger/go) on `.pn-root` (panels.css:12-51), which also redeclares `--ov-*` with different values (:52-60, e.g. `--ov-green:#4cd964` vs `#6ddc93`; `--ov-chip` .14 vs .08). So `--ov-chip` means different things in web card and native pane. (d) Auth `--auth-*` (styles.css:96-). Presentation has no tokens.
- Hard-coded colour literals (hex/rgb outside var definitions): presentation.css 163 (vs 5 var()), panels.css 84, start-panel.css 35, styles.css 30, overlay.css 23, library.css 18, screenshots.css 17, workspace.css 6, and workspace.css:682 uses raw oklch for spinner. Studio-token views (behavioural, home, rehearsal, account, documents) are clean.
- Naming of state: `.on`, `aria-pressed`, `aria-checked`, `[data-alert]`, `.interim`, `.preview/.applied`, tone as a bare class (`.amber`) are all used for variant/state.

## 4. Proposed shared components
Config vocabulary follows the button plan (`variant`, `size`, `tone`, `state`). Priority is value divided by risk.

| # | Primitive | Props / vocabulary | Replaces | Priority |
|---|---|---|---|---|
| 1 | `Spinner` | `size: xs\|sm\|md`, `tone: accent\|current`, `label` | 8 spinner classes | P1 (trivial, no behaviour) |
| 2 | `Chip` / `Badge` | `tone: neutral\|accent\|green\|amber\|red`, `size: sm\|md`, `as: span\|button`, `icon`, `dot` | live-chip, bp-chip, dx-chip, ov-chip, pn-chip, home-chip, ws/ss/bp badge | P1 |
| 3 | `Banner` (+ `Notice`) | `tone: info\|amber\|red\|green`, `role` derived from tone, `icon`, `action`, `onDismiss`, `layout: full\|inline` | live-banner, live-notice, live-bar-notice, dx-banner/notice, rehearsal-banner, auth-banner, pn-start-banner, cp | P1 (session banners and capture-problem first) |
| 4 | `Switch` | `checked`, `onChange`, `label`, `disabled` | setup-switch, rehearsal-switch | P1 (2 near-identical) |
| 5 | `ToggleGroup` / `Segmented` | `type: single\|multiple`, `value`, `size`, `items[{value,label,icon}]`, radio vs pressed semantics fixed per `type` | setup/dx/ov segmented, pn-file-tab | P2 |
| 6 | `Tabs` | `Tabs/TabList/Tab/TabPanel`, roving tabindex + arrows, `variant: underline\|pill\|file`, `badge`, `alert` | 7 tab strips | P2 |
| 7 | `Field` + `Input` / `Textarea` / `Select` / `Checkbox` | `size`, `invalid`, `mono`, `label`, `hint`; one class instead of descendant selectors | 12 rule sets, Presentation's 29 unclassed controls | P2 (large, mechanical) |
| 8 | `Menu` (+`MenuItem`, `MenuLabel`, `MenuSeparator`) over the existing `Popover` | `kind: menu\|dialog`, `placement`, `item role: item\|radio\|checkbox`, `danger`, `onDismiss` via the one `useDismiss`, arrow nav in one place | ov-menu, dx-menu, bp-menu, ws-versions-menu, account menu, session-switcher, window-dots | P2 (native hit-region risk, see 6) |
| 9 | `Card` / `Panel` | `variant: surface\|glass\|outline`, `Header/Body/Footer` slots | 15 card families | P3 (layout tweaks) |
| 10 | `Dialog` (extend existing) + `ConfirmDialog` | `scrim`, `size`, `onClose`, `danger` | sign-out-dialog, end-confirm, image-viewer, mask-editor | P3 |
| 11 | `Toast` / `Toaster` | `tone`, `title`, `detail`, `duration` | dx/live/pn/pn-start toasts | P3 |
| 12 | `EmptyState` | `icon`, `title`, `description`, `action`, `size` | 13 empties | P3 |
| 13 | `Tooltip` | `content`, `side`, hover and focus; wraps `title` | 56 `title=` | P4 (optional; native panels can't host portals easily) |
| 14 | `Icon` | exists; add `size: sm\|md\|lg` | | keep |
| 15 | `Skeleton`, `Stack/Row` | none exist; do not add speculatively | | skip |

Tokens: the kit needs one semantic token layer (`--ui-surface`, `--ui-text`, `--ui-muted`, `--ui-border`, `--ui-accent`, `--ui-ok/warn/danger`, radius/control sizes), with the Studio set (`tokens.css`), the glass set (`--pn-*`) and the card set (`--ov-*`) each mapping into it as a theme (`data-ui-theme="studio|glass|card"`). This resolves the `--ov-chip` double meaning and keeps the glass-guard contract (literal backgrounds forbidden under `.pn-root`).

## 5. Proposed folder organisation
Reference (`omni-ui-components/packages/core/src/components/ui`): flat, one file per shadcn primitive (alert, avatar, badge, button, calendar, card, checkbox, command, dialog, dropdown-menu, hover-card, input-otp, input, label, popover, radio-group, select, separator, sheet, slider, switch, tabs, textarea, toggle-group, toggle, tooltip), each `cva` variants + `cn()` + `forwardRef`, Radix underneath, Tailwind classes, `lib/utils.ts` (`clsx` + `tailwind-merge`). This repo uses plain CSS and tokens, no Tailwind, and the native pages are standalone documents, so adapt: keep the file-per-primitive layout and variant tables, replace Radix and Tailwind by small hand-written components and one `ui.css` (data-attribute variants: `data-variant`, `data-size`, `data-tone`). The existing Popover and Dialog already carry focus and dismiss logic worth keeping rather than swapping to Radix.

Options for placement (Phase 2 decision, ADR if a package is created because rule 2 and ADR-0003 give each package one entry and `apps/web` thinness is guarded by scripts/web-thinness.test.ts, scripts/package-boundaries.test.ts, scripts/export-surface.test.ts):
```
packages/ui/                      (new package, ADR needed; used by interview + presentation + web)
  src/index.ts                    (one public entrypoint)
  src/ui/{button,chip,badge,banner,switch,toggle-group,tabs,input,textarea,select,
          checkbox,field,menu,popover,card,dialog,toast,empty-state,spinner,icon}.tsx
  src/ui/*.test.tsx               (one test per primitive)
  src/styles/{tokens.css,ui.css}  (tokens first, then one section per primitive)
  src/lib/cn.ts, use-dismiss.ts
```
Lower-risk interim (no new package): `products/interview/src/frontend/studio/ui/` with the same file names and `ui.css` imported from tokens.css, and Presentation adopts it later by its own ADR. Because Presentation is a second product, the new-package route is the one that removes the 163 literals; it needs the ADR.

## 6. Risks
- Class-name coupled native lists: `HIT_SELECTORS` (S/live/overlay/panels/hit-regions.ts:21-37: `.pn-pill .pn-strip .pn-card .pn-codecard .pn-single-foot .pn-single-confirm .pn-ended .pn-mini-card .pn-mini-foot .pn-start-card .pn-start-toast .pn-menu .ov-rev-menu .pn-toast .pn-jump .ss-viewer-scrim`; tests hit-regions.test.tsx). A shared Menu, Toast, Card or Banner that renames `.pn-menu`/`.pn-toast`/`.pn-card` silently makes that surface click-through in the native window. Swift: `WindowDrag.chrome = ".pn-pill,.pn-single-foot"` (apps/studio-shell/Sources/StudioShellCore/WindowDrag.swift:24) and `typing` (:41-42: `.pn-log .pn-interim .pn-analysis-text .pn-codecard .pn-strip-main .pn-strip-sub .pn-note`); WindowDragTests.swift:12-19 asserts them. Safest approach: keep the legacy class as an additional class on the shared component (`className` pass-through) and add `data-ui-*` for new styling.
- CSS guard tests read stylesheets as text: glass-guard.test.ts (panels.css, start-panel.css, screenshots.css, overlay.css; 36 ALLOWED entries keyed by file and selector; fails on a literal dense background or blur and on stale entries), panels-css.test.ts (rules `.pn-display-menu`, `.pn-single-body:has(...)`). Moving rules to a new `ui.css` makes ALLOWED entries stale and must update them; new shared styles under `.pn-root` must use tokens only.
- Tests assert classes, roles and text: about 100 class assertions across 25 test files (single-panel.test.tsx 14, capture-ui.test.tsx 12, markdown-content.test.tsx 16, studio.test.tsx 8, session-bar.test.tsx 8, document-preview.test.tsx 8, sheet.test.tsx 5, overlay.test.tsx 5), `role="menuitem(radio)"`, `aria-checked/pressed/selected`, `data-testid`s (`revisions-button`, `capture-problem*`, `end-scrim`, `sign-out-scrim`), and accessible-names.test.tsx. Keep roles, names and test ids identical in each slice.
- E2E Playwright specs select by class (`e2e/live-session/tests/*.spec.ts`, e.g. code-tests-native, web-code-canvas, native-details, claims.ts).
- Behavioural risk when unifying menus: Popover applies `useToolbarLock` (disabled trigger with reason) which is native-only; web menus must not inherit it. Dialog consolidation changes focus return and Escape handling on four bespoke modals. Tabs consolidation adds roving focus to 5 strips (a behaviour change; test first).
- Native panel pages are standalone documents with no `.studio-app`, so the shared kit's tokens must resolve under `.pn-root`/`.ov-card` too (the reason `--ov-*` exist, overlay.css:1-5).
- Presentation (P/index.tsx 2641 lines) and apps/web styles.css:385-535 style bare `input, select, textarea` globally; introducing a field class there alters unclassed controls everywhere.
- Scope guard: AGENTS.md rule 1 asks for a checkpoint above 1,000 changed lines; the chip, banner, field and card slices each exceed it and should be split per surface.

## 7. Suggested order
Spinner, Chip/Badge (live-chip first), Switch, Banner (session banners, capture-problem), Tabs and ToggleGroup, Field controls (Studio views first, Presentation last), Menu on `Popover`, Dialog consolidation, Card, Toast, EmptyState, Tooltip last.
