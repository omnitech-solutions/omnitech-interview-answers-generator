# Audit A: web buttons (read-only, 2026-10-06)

Scope: every React/TSX button-like element in `products/*/src/frontend` and `apps/web`. `packages/*` contains no `.tsx` (no React there). Method: scripted scan of every `<button` opening tag (non-test files), plus greps for `role="button"` (none exist), `<a>` styled as a button, and each CSS rule that styles a button class. The full per-element listing (419 `<button>` elements in 85 files; 62 in `products/presentation/src/frontend/index.tsx` alone) is in the Appendix. File paths below are shortened: `S/` = `products/interview/src/frontend/studio/`, `L/` = `S/live/`, `OV/` = `S/live/overlay/`, `PN/` = `S/live/overlay/panels/`.

Headline facts:
- There is no shared button component in this repo. Every site is a raw `<button type="button" className=...>`; 14+ unrelated class families draw buttons (`.studio-button`, `.dx-button`, `.ov-button`, `.pn-*`, `.ss-btn`, `.lc-button`, `.cp-button`, `.live-bar-button`, `.live-banner-action`, `.auth-button`, `.bp-*`, `.home-link`, `.setup-link`, presentation element selectors).
- `.studio-button` is defined twice and merged: `S/studio-base.css:252` (min-height 36, filled accent default, `.outline` modifier) and `S/tokens.css:366`-area (`@import "./studio-base.css"` at `tokens.css:2`; tokens.css rule: height 32, surface/outline default, `.primary` fills). The two have opposite defaults (accent-filled vs outlined); tokens.css wins by order, so `.outline` in studio-base.css is dead for new code, but both files are live.
- The vendored `@oc-tech/omni-ui-components` tarball is already a dependency (`package.json:58`, `apps/web/package.json:17`) and imported in `apps/web/app/layout.tsx`; worth noting for Worker D.
- Non-`<button>` button-likes: `<a className="pn-bar-button" href="/sign-in">` (`PN/panels-root.tsx:170`), `<a className="auth-primary">` (`apps/web/app/signed-out/signed-out-view.tsx:19`), `<a className="ov-link" href="/sign-in">` (`OV/overlay-page.tsx:88`), `<a role="menuitem" className="studio-account-item">` (`S/account/account-menu.tsx:118,128`), presentation menu anchors (`products/presentation/src/frontend/index.tsx:1465,1935,1993`), `<summary>` disclosures (`L/coding-panel.tsx:94`, `L/session-draft-panel.tsx:360`, `OV/overlay-task.tsx:87`, `PN/code-card.tsx:170`, `S/live/ended-results.tsx:66`). No `role="button"` anywhere.

## 1. Inventory by family

Size = declared height/min-height. States: H hover, F focus-visible (own rule), D disabled, P pressed (`aria-pressed`/`.on`/`[aria-expanded]` styling), L loading/pending (label swap or `aria-busy`; no spinner except noted).

| Class (CSS file:line) | Variant | Size | States in CSS | Sites (TSX file:line) | Icon / label notes |
|---|---|---|---|---|---|
| `.studio-button` (`studio-base.css:252`, `tokens.css` rule; ~47 plain + 15 `.primary` + modifiers `large`, `danger`, `studio-button-danger`, `ended-danger`, `live-copy`, `ws-run`, `ws-next`, `home-open`, `live-bar-button`) | secondary default, `.primary` fill, `.danger`/`-danger` fill red | 32 (tokens), 36 (min, studio-base), 36 in `.studio-page-head`, 38 in `.setup-footer` (`setup.css`), min 40 in `.live-page`/`.live-session-bar` (`live.css`), `large` 36/13.5px (`behavioural.css`) | H yes; D opacity .5 (.6 in modal, cursor `default` vs `not-allowed` varies per container); P only in `.ended-shorten` (`ended.css`); F only via `.live-page`/`.documents-view` scoped rings; none in home/briefings/workspace/rehearsal/account modal | S/home/home-view.tsx:45,53; S/rehearsal/*; S/workspace/*; S/briefings/*; L/ended-*.tsx; L/pairing-panel.tsx:87-158; L/setup-footer.tsx:38; S/account/sign-out-dialog.tsx:104,113 | Icon left, 16px mostly (`size={16}`; some default); labels sentence case |
| `.studio-icon-button` (`tokens.css:366`) | icon, ghost | 30x30 r8 | H; no D, no F | S/sidebar.tsx:180; S/account/welcome-banner.tsx:44; S/briefings/*:139,246; behavioural-pack.tsx:640 (send); briefing-tabs.tsx:439 (copy); questions-card.tsx:61 | all have `aria-label` |
| `.studio-primary-action` (`apps/web/app/styles.css:448`) | primary | auto (padding .75rem 1rem), r .75rem | none, literal `#6d5dfc` | products/presentation index.tsx:1666,1851,2219,2376 | no icon |
| `.dx-button` (`documents.css:81`; `-sm/-lg/-xs`, `-primary`, `-ink`, `dx-self-start`) | secondary, primary, ink, sm/lg/xs | 32 default; sm/lg/xs sizes in same file | H; D; `[data-active]` soft fill; F via `.documents-view :is(button...)` (`documents.css:32`) | S/documents/document-editor.tsx:343-812; documents-list.tsx:46; documents-view.tsx:114,167; new-document-dialog.tsx:361,371,609; template-library.tsx:66-475 | Icon left 17-18px; trailing `expand_more` 16 (document-editor.tsx:488); only family with a real loading pattern: `{busy ? <Spinner/> : <Icon/>}` (new-document-dialog.tsx:371) |
| `.dx-icon-button` (`documents.css:105`; 28 in toolbar) | icon | 30 / 28 | H; P `[aria-pressed]` | document-editor.tsx:1076; documents-ui.tsx:48 | |
| `.dx-menu-item`, `.dx-option` (+`dx-radio`,`dx-stage`), `.dx-doc-row`, `.dx-section-head`, `.dx-dropzone` | menu item / choice card / row | auto | H, `[aria-current]`, `[aria-pressed|checked]` | document-editor.tsx:537-670,870; new-document-dialog.tsx:415-554; documents-list.tsx:60; template-library.tsx:92,499 | |
| `.ov-button` (`overlay.css:830`; `.primary`, `.danger`; `.go` only under `.pn-strip`/`.pn-single-foot` at `panels.css:649,654`) | secondary, primary, danger, go | 26 (overlay); 3px/8px pad + 1px glass border in `.pn-strip`/`.pn-single-foot` (`panels.css:588,664`) | H (not:disabled); D .45; no own F (card-level ring `overlay.css:131`) | OV/overlay-footer.tsx:205,238,249 (footer buttons from `footerButtons()`, `PN/toolbar-config.ts:~340`), PN/status-strip.tsx:109; OV/mask-editor.tsx:308-319; OV/companion-setup.tsx:79; OV/overlay-card.tsx:472; OV/overlay-task.tsx:239; OV/source-popover.tsx:48 | Icon left filled (footer) / unfilled (companion); `.go` has no base rule in `overlay.css`, so the legacy card shows it as a default button |
| `.ov-icon-button` (`overlay.css:248`; `.on`, `.live`, `.ov-handle`, `.ov-mic`) | icon ghost | 24, 22 (`.ov-chips`), 26 (`.ov-bar`) | H; D .35; `.on` soft accent | OV/command-bar.tsx:72-122; OV/overlay-card.tsx:191-320; OV/session-switcher.tsx:118,149; OV/hands-free-controls.tsx:509; OV/companion-setup.tsx:65; OV/overlay-capture.tsx:239 | |
| `.ov-link` (`overlay.css:571`) | link | 12.5px text | H underline | OV/auto-status.tsx:27; hands-free-controls.tsx:119; companion-setup.tsx:49; device-only-notice.tsx:62; overlay-card.tsx:351,382; overlay-page.tsx:88 (`<a>`,121 button) | |
| `.ov-analyze` (+`stop`) (`overlay.css:465`) | primary, `stop` | 28 | D .45; `aria-busy` set in JS but no CSS | OV/hands-free-controls.tsx:159,170; OV/overlay-capture.tsx:274,288 | `center_focus_strong` / `stop_circle` left; "Capturing…", "Stopping…" |
| `.ov-pill-button`, `.ov-task-button`, `.ov-segment` (`live.css:151`), `.ov-preset`, `.ov-source`, `.ov-send`, `.ov-menu-item` (`overlay.css:357`), `.ov-switcher-current`, `.ov-disclosure-head` | chips / toggles / menu | 22, 22, 28, 32, 22, 26 | H; P `[aria-pressed]` (task, segment); menu F + hover = full accent fill | OV/command-bar.tsx:97,113; overlay-card.tsx:398; hands-free-controls.tsx:437; mask-editor.tsx:295; overlay-capture.tsx:347-502 (10 menu items); session-switcher.tsx:128,170,189 | |
| `.pn-bar-button` (`panels.css:190`; `.pn-icon-button`, `.pn-mic-button`) | ghost; in `.pn-pill` becomes a glass pill | `--pn-control` height, radius = height/2, 12px; bare: 2px 4px pad r6 | H; D .45; F `panels.css:789` (2px `--pn-link`, offset 1); P `[aria-pressed|expanded]` fill .24; icon-only P tints `--pn-link` | PN/toolbar.tsx:162,208,405; PN/panels-root.tsx:170 (`<a>`),197; PN/start-panel.tsx:188; L/shared/missing-context-strip.tsx:78 (via `VARIANT.native`) | Icon left; `kbd` chord on right in some |
| `.pn-split-main/-menu` (`panels.css`) | split button, toolbar | `--pn-control` | same glass rules; `[data-stop=true]` red .55 | PN/toolbar.tsx:102 | |
| `.pn-mini-button` (`panels.css:1139`; `.pn-mini-back`, `.pn-quit-confirm`; `[data-action=resume]` green) | secondary small | 24, r7, 11.5px | H; no D rule, no F rule beyond root `.pn-root :is(button...)` (`panels.css:87`) | PN/answer-pane.tsx:220,325; PN/code-card.tsx:93; PN/mini-player.tsx:80,116,127; PN/window-dots.tsx:260,268; L/shared/screenshots-area.tsx:48 (native toggle) | Icon left; "Copy"/"Copied" with `check` swap |
| `.pn-primary` (`panels.css:1161`) | primary | `--pn-control`, r8 | D .45; no H | PN/answer-pane.tsx:173 | icon left + `kbd` right |
| `.pn-round` `.pn-mic` `.pn-send` | icon filled | 26x26 r6 | D .45 | PN/panel-views.tsx:365,375 | |
| `.pn-danger` (`panels.css:282`) | destructive | r6, 3/10 pad | H | PN/panel-views.tsx:432 "Quit", 440 "Close" | no icon |
| `.pn-menu-item` (`panels.css:1002`) | menu item | r6, 7/9 pad | H+F fill accent; `[aria-disabled]` .4 but code uses real `disabled` (toolbar.tsx:318) | PN/toolbar.tsx:318,371; screen-picker.tsx:75,90; start-panel.tsx:371; window-dots.tsx:367 | check icon left reserved with opacity 0/1 |
| `.pn-task-chip`, `.pn-file-tab`, `.pn-copy`, `.pn-jump`, `.pn-linkbtn`, `.pn-note-close`, `.pn-tests-handle`, `.pn-window-dot` | chips/tabs/icon/link | 24, 22, 20, auto, auto, -, -, 12 | `[aria-pressed]` for chip/tab; F for `.pn-copy`, `.pn-window-dot` | PN/status-strip.tsx:95; code-card.tsx:105,154; panel-views.tsx:140,325; answer-pane.tsx:344; tests-drawer.tsx:25,65; window-dots.tsx:132 | `.pn-jump` is in `HIT_SELECTORS` |
| `.pn-start-*` (`start-panel.css:160-482`): `primary` (36), `secondary` (36), `provider` (38, brand colours), `local` (38), `go` (38, r10, `--pn-danger` bg), `quiet` (26), `chip` (28), `link`, `target`, `agree` | primary/secondary/brand/destructive-looking go/ghost/link | 26-38 | D: provider .45 not-allowed, primary .6 `progress`; `go[data-blocked]`; `go` has spinner (`pn-start-spinner`, start-panel.tsx:787) | PN/start-panel.tsx:188-850 (17 buttons) | "Continue with Google/LinkedIn", "Back", "Continue on this Mac" |
| `.live-bar-button` (`session-bar.css:118`, on top of `.studio-button`) | secondary + `.danger` fill | min 40x40 | D .6 `progress`; danger hover brightness | L/session-bar.tsx:225 "Pop out", 237 "Open", 247 Pause/Resume (face from `PAUSE_CONTROL`, `session-bar-model.ts:206`), 258 "End"; L/end-confirm.tsx:71,79 | Icon filled, 17px |
| `.live-banner-action` (`session-view.css:82`) | primary; `.earlier` variant outlined | min 40, nominal 28, r7 | D .55; F `session-view.css:198` | L/session-banner-list.tsx:51 (label from `banner-copy.ts:26`: "Resume"); L/task-panels.tsx:241 | no icon |
| `.cp-button/.cp-close` (`capture-problem.css:44`) | outline/ghost | min 28 | H | L/shared/capture-problem-banner.tsx:35,46 | |
| `.lc-button/.lc-tab/.lc-results-head` (`code-canvas.css:83`) | chip toolbar | 24 (compact: 24 square icon-only); ::before hit area -8px | H; D .5; P `[aria-pressed]` outline | OV/code-canvas.tsx:310-428 | label dropped in compact density, `aria-label` kept |
| `.ss-btn`/`.ss-icon` (`screenshots.css:143`; `.primary`) | secondary/icon/primary | min 24, r7 | D .45 not-allowed; P outline | L/shared/screenshots-area.tsx:138-430; image-viewer.tsx:202-258; crop-editor.tsx:194-210 | |
| Web live: `.live-chip-button`, `.live-tab`, `.live-coding-tab`, `.setup-segment/-switch`, `.setup-link`, `.live-missing-button` | chips/tabs/switch/link | 22 visual, ::before enlarges | F `session-view.css:198,327` | L/task-panels.tsx:138; claim-chips.tsx:46; session-tabs.tsx:55; setup-controls.tsx:53,112; setup-sections.tsx:155 | |
| Knowledge/briefing/home: `.library-*`, `.bp-*` (`bp-back`, `bp-link`, `bp-accept`/`accepted` 30 tall, `bp-source`, `bp-role`, `bp-matrix-button`, `bp-drop`), `.home-link`, `.home-tick`, `.home-remove`, `.briefings-item`, `.studio-nav-item`, `.studio-jump`, `.studio-collapse`, `.studio-account-*`, `.ws-*` (file/tab/code-icon/versions-item/example-card/step/check/test-action), `.rehearsal-*` (check/format/switch/next/start), `.library` mixed | links, tabs, toggles, rows | varied | `.home-remove:focus-visible` (`home.css:198`); account (`account.css:28`) | see Appendix | |
| `apps/web`: `.auth-button` (42, r10), `.auth-primary` (`<a>`, 40, r10), global-error "Try again" with no class (`global-error.tsx:35`) | primary/provider | 40-42 | F `styles.css:225` (only family with ring on every button); D .45 | apps/web/app/sign-in/sign-in-view.tsx:32,117; signed-out-view.tsx:19 | |
| Presentation (`presentation.css`, 34 button rules) | element selectors under `.presentation-reference-*`; many bare `<button>` | min 56 rail, etc. | hex literals, no tokens | products/presentation/src/frontend/index.tsx (62), slide-blocks.tsx (5) | **Unicode glyphs as icons** (`＋ ✣ ⟳ ↶ ↷ ⚙ × ★ ☆ ♥ ☰ ✎ ↑ ↓`), "Previous/Next" without icon |
| `markdown-content.tsx` toolbar (`I/markdown-content.tsx:149-284`) | unclassed icon buttons styled by `.mermaid-toolbar button` (`studio-base.css:~70`, F at :75) | | | inline `<svg>` icons, not `<Icon>` | |

## 2. Duplicate groups (same job, different drawing)

- **Resume** (7 drawings): status strip `ov-button go` + `play_arrow`, label "Resume session" (`PN/status-strip.tsx:109`, `strip-model.ts:59`); footer `ov-button go` + `play_arrow`, "Resume session"/"Resume" (`toolbar-config.ts:~373`, `OV/overlay-footer.tsx:205`); Mini player `pn-mini-button` with `data-action=resume` green (`PN/mini-player.tsx:127-130`, `panels.css:~1150`); session bar `studio-button live-bar-button` + filled `play_arrow` "Resume" (`L/session-bar.tsx:247`); web banner `live-banner-action` "Resume" no icon (`banner-copy.ts:26`, `session-banner-list.tsx:51`); rehearsal `studio-button` + `play_arrow`, "Resume" (`S/rehearsal/live-session.tsx:120`); presentation "Resume with prompt" bare button (`index.tsx:1844`).
- **Pause**: footer `ov-button` default + `pause`; session bar `studio-button live-bar-button` + filled `pause`; rehearsal `studio-button`; mini-player `pn-mini-button`; practice timer `ws-practice-button` (`S/practice-timer.tsx:23`).
- **End / Stop / destructive**: footer `ov-button danger` "End now" (`overlay-footer.tsx:249`); session bar `studio-button live-bar-button danger` + `stop_circle` "End" (`session-bar.tsx:258`); `end-confirm.tsx:79` "End session"; rehearsal "End session" is `studio-button primary` (not red; `live-session.tsx:129`); `pn-danger` "Quit"/"Close"; `pn-start-go` is a red-background Start button; `ov-analyze stop` / `pn-mini-button` "Stop analysis".
- **Start**: `studio-button primary` "Start session" (`setup-footer.tsx:38`), "Start a session"/"Start another session" (`ended-view.tsx:187,220`), `pn-start-go`, `rehearsal-start` ("Start {format}"), footer `go` "Start a new session".
- **Copy** (12 drawings): `studio-button live-copy` "Copy answer", `ov-button` "Copy answer" (`overlay-card.tsx:472`), `pn-mini-button` "Copy"/"Copied", `pn-copy` icon (20px), `ws-code-icon`, `lc-button` ("Copy"/"Copy all"), `studio-icon-button`, `ov-icon-button`, markdown toolbar svg button, `ended-results.tsx:29`, `pairing-panel.tsx:96`. All swap `content_copy` to `check` and label to "Copied", but each implements its own timeout/state.
- **Cancel** (9): `studio-button`, `dx-button`, `dx-button-lg` ("Cancel generation"), `ss-btn`, `ov-button`, `pn-start-quiet`, `pn-mini-button`, `studio-button live-bar-button` ("Keep going" is the cancel for End confirm), bare presentation "Cancel agent".
- **Retry/Try again**: "Retry"/"Try again" appear as `studio-button`, `dx-button`, `home-link`-less bare buttons (`home-view.tsx:66,134`, `sidebar.tsx:131`), `pn-bar-button`, `pn-start-quiet`, `setup-link`, `global-error.tsx:35`, `ss-btn primary` ("Retry").
- **Close/Dismiss** (icon `close`): `studio-icon-button`, `ov-icon-button`, `pn-note-close`, `cp-close`, `ss-icon`, `home-remove`, presentation `×`.
- **Primary submit**: `studio-button primary`, `dx-button-primary`, `ov-button primary`, `ov-analyze`, `pn-primary`, `pn-start-primary`, `ss-btn primary`, `live-banner-action`, `studio-primary-action`, `auth-primary`, `bp-accept`.
- **Menu item** (7 classes): `ov-menu-item`, `pn-menu-item`, `dx-menu-item`, `ws-versions-item`, `studio-account-item`, `studio-palette-item`, plus `bp` matrix items.
- **Tabs** (6): `lc-tab`, `ws-file`, `ws-panel-tab`, `live-tab`, `live-coding-tab`, `pn-file-tab`.

## 3. Inconsistencies

- **Heights**: 20, 22, 24, 26, 28, 30, 32, 36, 38, 40, 42 px for "the same" buttons; `.studio-button` alone is 32, 36, 38 or 40 depending on ancestor. A 40 px touch-target rule exists only for the live web page (layout-rules test).
- **Radii**: 5, 6, 7, 8, 9, 10, 11, 999 px; pills use height/2.
- **Primary colour**: `--accent`, `--ov-accent`, `--pn-accent`, `--ss-accent`, `--auth-accent`, literal `#6d5dfc` (`styles.css:448`) and presentation hex colours. Resume green is `rgba(46,160,90,.9)` (panels.css:649,654), `--pn-go`, or none (session bar, banner).
- **Destructive**: `--red` fill (`live-bar-button.danger`), `--ov-red` fill, `rgba(214,62,52,.9)`, `rgba(255,69,58,.85)` (`pn-danger`), `--pn-danger` (start-go, which is a Start button), `red-soft` outline (pairing), `ended-danger`. "End session" in rehearsal is not destructive-styled.
- **Labels**: "Resume" vs "Resume session"; "Pause" vs "Pause session"; "End" vs "End now" vs "End session"; "Copied" vs "Code copied" vs "Syntax copied"; "Try again" vs "Retry" vs "Retry deletion"; "Cancel" vs "Keep going" vs "Keep it" vs "Discard"/"Dismiss"; ellipsis char in "Capturing…" but "Cropping..." (`crop-editor.tsx:210`); "Practise" (UK) vs "Analyze" (US).
- **Icons**: Material Symbols via `<Icon name size filled>` mostly; size drifts 14/15/16/17/18; `filled` inconsistent for same action; inline `<svg>` in markdown toolbar; unicode glyphs in presentation; `|<|` text in `pn-tests-handle` (`tests-drawer.tsx:25`). Left icon dominant; right icons only for chevrons (`stage-panes.tsx:65`, `document-editor.tsx:488`) and kbd hints.
- **Disabled**: opacity .35/.4/.45/.5/.55/.6 and cursor `default`/`not-allowed`/`progress`; `pn-menu-item` styles `[aria-disabled]` but code sets `disabled`. Some "disabled" menu items have a hover fill (`.ov-menu-item:hover:not(:disabled)` ok; `.pn-mini-button` has no D rule).
- **Loading**: no common pattern: label swap ("Starting…", "Generating…"), `aria-busy` with no CSS (`session-bar.tsx:247-258`, `ov-analyze`), spinner only in `dx-button` (new-document-dialog:371) and `pn-start-go`.
- **Pressed**: `aria-pressed` styled as: soft fill (`ov-task-button`, `dx-icon-button`), outline (`lc-button`, `ss-btn`), full fill (`pn-bar-button`), colour swap (`pn-icon-button`); several toggles misuse `aria-selected` on `role=tab` buttons (fine) but `bp-source`/`ws-example` use none.
- **Focus-visible**: own ring on only about a third of the families; most rely on container rules (`.live-page :is(button...)` `live.css:44`, `.documents-view` `documents.css:32`, `.ov-card` `overlay.css:131`, `.pn-root` `panels.css:87`, `.ss` `screenshots.css:195`). `.studio-button`/`.studio-icon-button` in home, workspace, rehearsal, briefings, account modal have no ring rule at all. Ring colours differ (`--accent`, `--pn-link`, `--auth-link`).
- **Semantics**: `type="button"` present everywhere sampled; `role="checkbox"`/`radio`/`switch`/`tab`/`menuitem*` used on `<button>` (valid); `home-tick` is `role=checkbox` button. `<a>` used as button in 3 places above.

## 4. Proposed single vocabulary

One component `Button` (and `IconButton` as `size="icon"`), config via props, mapped to tokens already in the tree.

- `variant`: `primary` (accent fill) | `secondary` (default outlined/surface) | `ghost` (transparent, hover fill) | `destructive` (red fill) | `go` (green fill, Resume/Start) | `link` (text, underline on hover) | `glass` (translucent, native panel chrome; carries the `rgba`/backdrop tokens the glass guard allows) | `chip` (pill, `pressed` styled; for task/file/segment toggles).
- `size`: `xs` 20/22, `sm` 24-26, `md` 32, `lg` 36-40, `icon` (square at the same four heights). Density comes from a container token (`--btn-h-*`), not from descendant selectors.
- `state`: `disabled` (one opacity .45, `not-allowed`), `pressed` (`aria-pressed`, one look per variant), `expanded` (`aria-expanded` for menu triggers), `loading` (sets `aria-busy`, disabled, swaps icon slot for spinner, label stays), `active` for tabs not buttons.
- Focus: one ring on `:focus-visible` in the component itself, ring colour token `--btn-ring`.
- Slots: `icon` (name) + `iconPosition` left | right, `iconFilled`, `kbd` (right hint), `children` label, `aria-label` required when no label.
- Also `asChild` for `<a>` cases.

| Existing | Maps to |
|---|---|
| `.studio-button`, `.dx-button`, `.ss-btn`, `.cp-button`, `.ov-button`, `.pn-mini-button`, `.lc-button`, `.bp` secondary | `secondary` md/sm |
| `.studio-button.primary`, `.dx-button-primary`, `.ov-button.primary`, `.pn-primary`, `.ov-analyze`, `.pn-start-primary`, `.ss-btn.primary`, `.live-banner-action`, `.studio-primary-action`, `.auth-primary`, `.bp-accept` | `primary` |
| `.studio-button.danger`, `.live-bar-button.danger`, `.ov-button.danger`, `.pn-danger`, `.ended-danger`, `.studio-button-danger` | `destructive` |
| `.ov-button.go`, `.pn-mini-button[data-action=resume]`, session-bar Resume, banner Resume | `go` |
| `.pn-start-go` | `primary` (it is a Start action; currently red, which collides with destructive) |
| `.studio-icon-button`, `.dx-icon-button`, `.ov-icon-button`, `.ss-icon`, `.pn-round`, `.pn-copy`, `.ws-code-icon`, `.home-remove`, `.cp-close`, `.pn-note-close` | `ghost` size `icon` |
| `.pn-bar-button` (+icon, mic), `.pn-split-*` | `glass` (+ `icon`) |
| `.ov-link`, `.pn-linkbtn`, `.setup-link`, `.bp-link`, `.bp-back`, `.home-link`, `.library-back`, `.pn-start-link`, `.pn-start-quiet` | `link` |
| `.ov-pill-button`, `.ov-task-button`, `.pn-task-chip`, `.pn-file-tab`, `.ov-segment`, `.live-chip-button`, `.pn-start-chip`, `.ov-preset` | `chip` |
| `.auth-button` (+provider), `.pn-start-provider/local` | `secondary` lg with `brand` colour prop, or keep as `Button` + `className` |
| Menu items (`*-menu-item`, `ws-versions-item`, `studio-account-item`, `studio-palette-item`) | not a Button: a `MenuItem` primitive (Worker B) |
| Tabs (`lc-tab`, `ws-file`, `ws-panel-tab`, `live-tab`, `live-coding-tab`) | `Tab` primitive (Worker B) |
| Switch/segment/checkbox/radio buttons (`setup-switch`, `rehearsal-switch`, `rehearsal-check`, `rehearsal-format`, `dx-option`, `ws-check`, `home-tick`) | toggle primitives (Worker B) |
| Presentation bare buttons | `Button` with SVG/`Icon` instead of glyphs (last slice) |

## 5. Risks

- **layout-rules.test.ts** (`L/layout-rules.test.ts:108-128, 205-250, 362-385`): scans `<button` opening tags in the top-level `live/*.tsx` files by regex, requires every button to have at least one className, and requires each class to have `min-height >= 40` or a `::before` hit area (`.studio-button` is covered by `.live-page .studio-button, .live-session-bar .studio-button`, `live.css`); also asserts the shared ring `.live-page :is(button...)` uses `var(--accent)`; also forbids hex/rgb/oklch literals outside tokens.css (`:299`). A Button component that renders `<button>` from another file hides it from the regex (good) but a class-less button there fails the test.
- **session-bar.test.tsx:644**: regex expects `.live-bar-button { ... min-height: 40px }`; `:137,184` use `.live-bar-state`/`.live-bar-elapsed`.
- **glass-guard.test.ts** (`PN/glass-guard.test.ts`): scans `panels.css`, `start-panel.css`, `screenshots.css`, `overlay.css` for any literal background alpha > .30, hex, or `backdrop-filter` not `var()`/`none`, with an ALLOWED list keyed by exact selector: `.pn-danger` (:40), `.pn-mic`, `.pn-send`, `.pn-strip .ov-button.go`, `.pn-single-foot .ov-button.go`, `.pn-single-foot .ov-button.danger` (:84-96), `.pn-jump`, `.pn-quit-confirm`, `.pn-start-provider[data-provider=...]`. Renaming/replacing those selectors requires editing the allow-list; new variants must use tokens (`--pn-*`) or be added. `glass` variant tokens must be `var(...)`.
- **Tests keyed to labels/roles** (62 test files use testing-library): top `getByRole("button", { name })` names: Generate (21), Resume (17), Pause (12), End (12), Start session (11), `/Capture & analyze/` (10), Cancel (10), `/^Capture mode/`, `/Continue with Google/`, Copy (9), Show, Run, End session, Send message, See-through, Export, Delete session data, `T1 · `, Record, Next, Revoke. Also `querySelector(".pn-mic-button")`, `hit-regions.test.tsx:42-43` (`.pn-start-card`, `.pn-start-toast`), `start-panel.test.tsx` (17 hits on `pn-start-*`). Visible labels and accessible names must not change in a styling migration.
- **Native shell**: `HIT_SELECTORS` (`PN/hit-regions.ts:~19-35`) lists container surfaces only, and just one button class: `.pn-jump`. `WindowDrag.swift`: `controls` and `pressable` lists are tag/role based (`button`, `a[href]`, `[role=button]`, `[role=menuitem*]`, `[role=tab|switch|checkbox|radio]`, `summary`), `chrome = ".pn-pill,.pn-single-foot"`, `typing` has `.pn-strip-main` etc. (`WindowDrag.swift:~24-42`). So: any component must stay a real `<button>`/`<a href>`/ARIA-role element (a `<div onClick>` would show a grab cursor and be draggable); keep `.pn-pill`/`.pn-single-foot` wrappers; `.pn-jump` must remain or `HIT_SELECTORS` updates. The comment at `WindowDrag.swift` says the `typing` list is mirrored in `panels.css` (user-select), unrelated to buttons. Disabled elements (`[disabled],[aria-disabled=true]`) give the arrow cursor: `loading` must set `disabled` or `aria-disabled` consistently with that.
- **Heavy CSS coupling**: descendant overrides (`.pn-strip .ov-button`, `.pn-single-foot .ov-button`, `.live-page .studio-button`, `.setup-footer .studio-button`, `.studio-page-head .studio-button`, `.studio-modal .studio-button`, `.ended-shorten .studio-button`, `.pairing-actions .studio-button.danger`, `.bp .studio-button:disabled`) create context-specific sizes that must become explicit `size` props.
- **Two live `.studio-button` definitions** (`studio-base.css`, `tokens.css`); resolve before building a variant on it.
- `apps/web/.next*` build dirs contain stale compiled CSS; ignore in greps.

## 6. Migration order (smallest blast radius first)

1. Component + tokens + story/doc page (no consumers).
2. Resume family: status strip (`status-strip.tsx:109`), footer (`overlay-footer.tsx:205`), mini-player (`mini-player.tsx:127`), session bar (`session-bar.tsx:247,258`), banner (`session-banner-list.tsx:51`), rehearsal (`live-session.tsx:120`). Touches `panels.css`, glass-guard allow-list, session-bar/layout-rules tests.
3. Documents (`dx-button`/`dx-icon-button`): self-contained product area, one CSS file, own focus rule; includes the only existing loading pattern.
4. Live overlay card (`ov-button`, `ov-icon-button`, `ov-link`, `ov-analyze`, chips) and `lc-button`/`ss-btn`/`ss-icon`/`cp-button`.
5. Native panels glass family (`pn-bar-button`, `pn-mini-button`, `pn-primary`, `pn-danger`, `pn-round`, `pn-start-*`): highest risk (glass guard, hit-regions, WindowDrag, `start-panel.test.tsx`), do after the variant is proven.
6. `.studio-button` / `.studio-icon-button` consumers (home, rehearsal, workspace, briefings, knowledge, setup, ended, pairing, account): biggest count (~110 sites) and the dual definition; layout-rules test applies.
7. Links, chips, tabs, menu items and toggles go with Worker B's primitives (`ov-link`, `bp-*`, `home-link`, `*-menu-item`, `*-tab`).
8. `apps/web` auth buttons (`auth-button`, `auth-primary`, `global-error`) and `studio-primary-action`; then Presentation product (62 buttons, glyph icons, hex colours): separate product, last.

## Appendix: every `<button>` (file:line | className | attributes | content)

Paths shortened as above (`I/` = `products/interview/src/frontend/`). Generated by scanning each `<button` opening tag; `{...}` are JSX expressions truncated.

```
apps/web/app/global-error.tsx:35 | - |  |  Try again 
apps/web/app/sign-in/sign-in-view.tsx:32 | {`auth-button auth-${provider} | disabled={!configured} title={configured ? undefined : `${label} |  <span className="auth-mark" aria-hidden="true"> {mark} <
apps/web/app/sign-in/sign-in-view.tsx:117 | "auth-button auth-local-button" |  |  <AuthIcon name="desktop_windows" /> Continue as local user 
I/library.tsx:461 | "library-mobile-control" |  |  Filters 
I/library.tsx:481 | { tags.some((tag) => technologyTags.has(tag)) ? "" : "active" } | aria-pressed={!tags.some((tag) => technologyTags.has(tag))} |  All 
I/library.tsx:496 | {tags.includes(tag) ? "active" : ""} | aria-pressed={tags.includes(tag)} |  {label} {facets?.tags[tag] ? <span>{facets.tags[tag]}</span> : null} 
I/library.tsx:523 | "library-clear-filters" |  |  Clear search and filters 
I/library.tsx:576 | {tags.includes(value) ? "active" : ""} |  |  {value} <span>{count}</span> 
I/library.tsx:593 | "library-back" |  |  ← {searching ? "Back to results" : "Back to Knowledge"} 
I/library.tsx:644 | "library-toc-toggle" |  |  Contents 
I/library.tsx:689 | - |  |  Clear search 
I/library.tsx:996 | {active ? "active" : ""} |  |  <span>{children}</span> {count === undefined ? null : <small>{count}</small>} 
I/markdown-content.tsx:149 | - | aria-label="Zoom out" title="Zoom out" |  <svg aria-hidden="true" viewBox="0 0 16 16"> <path d="M3 8h10" /> </svg> 
I/markdown-content.tsx:159 | - | aria-label="Zoom in" title="Zoom in" |  <svg aria-hidden="true" viewBox="0 0 16 16"> <path d="M8 3v10M3 8h10" /> </svg> 
I/markdown-content.tsx:169 | - | aria-label="Reset diagram view" title="Reset view" |  <svg aria-hidden="true" viewBox="0 0 16 16"> <path d="M13 5V2m0 0h-3m3 0-2.1 2.1a5 5 0 1 0 1.2 5.2" /> </svg>
I/markdown-content.tsx:180 | - | aria-pressed={showSource} aria-label={showSource ? "Hide syntax" : "Show syntax"} title={showSource ? "Hide sy |  <svg aria-hidden="true" viewBox="0 0 16 16"> <path d=
I/markdown-content.tsx:191 | - | aria-label={copied ? "Syntax copied" : "Copy syntax"} title={copied ? "Copied" : "Copy syntax"} |  <svg aria-hidden="true" viewBox="0 0 16 16"> {copied ? ( <path d="m3
I/markdown-content.tsx:208 | - | aria-label="Toggle diagram fullscreen" title="Fullscreen" |  <svg aria-hidden="true" viewBox="0 0 16 16"> <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /> </svg> 
I/markdown-content.tsx:284 | - | aria-label={copied ? "Code copied" : "Copy code"} |  {copied ? "Copied" : "Copy"} 
S/account/account-menu.tsx:72 | "studio-account-button" | aria-label={`Account: ${who.name} aria-expanded={open} title="Account" |  <span className="studio-avatar" aria-hidden="true"> {who.initials} <
S/account/account-menu.tsx:138 | "studio-account-item danger" | role="menuitem" |  <Icon name="close" /> Sign out 
S/account/sign-out-dialog.tsx:104 | "studio-button" | disabled={state === "working"} |  Cancel 
S/account/sign-out-dialog.tsx:113 | "studio-button studio-button-danger" | disabled={state === "working"} |  {liveSession ? "End session and sign out" : "Sign out"} 
S/account/welcome-banner.tsx:44 | "studio-icon-button" | aria-label="Dismiss welcome message" |  <Icon name="close" /> 
S/briefings/behavioural/answers-tab.tsx:111 | "studio-button" | disabled={!answers.length || accepted === answers.length} |  Accept all 
S/briefings/behavioural/answers-tab.tsx:161 | "bp-back" |  |  <Icon name="arrow_back" size={16} /> Change questions 
S/briefings/behavioural/answers-tab.tsx:211 | "bp-answer-head" | aria-expanded={open} |  <span className={`bp-dot ${state}`}> {busy ? ( <span className="bp-spinner" /> ) : ( <Icon name={ answer.acce
S/briefings/behavioural/answers-tab.tsx:257 | "studio-button" |  |  Cancel 
S/briefings/behavioural/answers-tab.tsx:264 | "studio-button primary" | disabled={!editing.trim()} |  Save 
S/briefings/behavioural/answers-tab.tsx:297 | "bp-source" | aria-pressed={source === item.key} |  <Icon name="work" size={14} /> {item.label} 
S/briefings/behavioural/answers-tab.tsx:329 | "studio-button" | aria-pressed={practising} |  <Icon name="mic" size={16} /> {practising ? "Stop practising" : "Practise"} 
S/briefings/behavioural/answers-tab.tsx:338 | "studio-button" | disabled={busy} |  <Icon name="refresh" size={16} /> New draft 
S/briefings/behavioural/answers-tab.tsx:347 | "studio-button" | disabled={busy || editing !== null} |  <Icon name="edit" size={16} /> Edit 
S/briefings/behavioural/answers-tab.tsx:358 | "bp-accepted" | title="Undo accept" |  <Icon name="check_circle" size={16} filled /> Accepted 
S/briefings/behavioural/answers-tab.tsx:368 | "bp-accept" | disabled={busy} |  <Icon name="check" size={16} /> Accept 
S/briefings/behavioural/behavioural-pack.tsx:508 | "studio-button" |  |  <Icon name="tune" size={16} /> Edit setup 
S/briefings/behavioural/behavioural-pack.tsx:543 | "bp-back" |  |  <Icon name="expand_less" size={16} /> Done 
S/briefings/behavioural/behavioural-pack.tsx:568 | - | aria-selected={tab === item.id} role="tab" |  <Icon name={item.icon} size={17} /> {item.label} {item.id === "answers" && ( <span className="bp-mo
S/briefings/behavioural/behavioural-pack.tsx:585 | "studio-button primary" | disabled={isSaved || drafting} |  <Icon name={isSaved ? "cloud_done" : "check"} size={16} /> {isSaved ? "Saved" : "Save pac
S/briefings/behavioural/behavioural-pack.tsx:640 | "studio-icon-button" | disabled={!askNext.trim() || drafting} aria-label="Answer it" |  <Icon name="arrow_upward" /> 
S/briefings/behavioural/briefing-tabs.tsx:52 | "studio-button primary" |  |  <Icon name="auto_awesome" /> Prepare the briefing 
S/briefings/behavioural/briefing-tabs.tsx:97 | "studio-button" | disabled={preparing} |  <Icon name="refresh" size={16} /> {preparing ? "Preparing…" : "Prepare again"} 
S/briefings/behavioural/briefing-tabs.tsx:301 | "bp-link" |  |  See the salary answer 
S/briefings/behavioural/briefing-tabs.tsx:439 | "studio-icon-button" | aria-label={`Copy: ${item.question} title={copied === item.question ? "Copied" : "Copy"} |  <Icon name={copied === item.question 
S/briefings/behavioural/matrix-picker.tsx:86 | "bp-matrix-button" | aria-expanded={open} |  <span className="bp-tile"> <Icon name="grid_view" /> </span> <span className="bp-grow"> <span className="bp-
S/briefings/behavioural/matrix-picker.tsx:114 | - | role="menuitemradio" |  <span className="bp-grow"> <span className="bp-matrix-name"> {profile.name} {profile.id === defaultId && ( <s
S/briefings/behavioural/matrix-picker.tsx:137 | - | role="menuitem" |  <Icon name="upload_file" /> Import from JSON… 
S/briefings/behavioural/matrix-picker.tsx:149 | - | role="menuitem" |  <Icon name="star" /> Make this my default 
S/briefings/behavioural/matrix-picker.tsx:246 | "studio-icon-button" | aria-label="Close" |  <Icon name="close" /> 
S/briefings/behavioural/matrix-picker.tsx:256 | "bp-drop" |  |  <Icon name="upload_file" size={26} /> <span>Drop a matrix .json file, or click to choose</span> {fileName && 
S/briefings/behavioural/matrix-picker.tsx:342 | "studio-button" |  |  Cancel 
S/briefings/behavioural/matrix-picker.tsx:345 | "studio-button primary" | disabled={!matrix || busy} |  {busy ? "Importing…" : "Import matrix"} 
S/briefings/behavioural/questions-card.tsx:39 | "studio-button" |  |  Reset 
S/briefings/behavioural/questions-card.tsx:61 | "studio-icon-button" | aria-label={`Remove question ${index + 1} |  <Icon name="close" size={16} /> 
S/briefings/behavioural/questions-card.tsx:93 | "studio-button primary large" | disabled={!canDraft} |  <Icon name="auto_awesome" /> Draft answers 
S/briefings/behavioural/setup-card.tsx:206 | - | role="radio" |  {item.label} 
S/briefings/behavioural/setup-card.tsx:219 | "bp-disclosure" | aria-expanded={moreContext} |  <Icon name={moreContext ? "expand_less" : "expand_more"} /> Job posting, research and notes <span> ·{" "}
S/briefings/behavioural/setup-card.tsx:255 | "bp-link" |  |  {allRoles ? `Show top ${TOP_ROLES}` : `Show all ${ranked.length}`} 
S/briefings/behavioural/setup-card.tsx:278 | "bp-role" | aria-pressed={on} title={`${item.role.title} role |  <Icon name={on ? "check_circle" : "add"} filled={on} /> <span className="bp-role-name">{it
S/briefings/brief-card.tsx:72 | - | aria-expanded={open === index} |  <span>{followUp.question}</span> <Icon name={open === index ? "expand_less" : "expand_more"} /> 
S/briefings/brief-card.tsx:89 | "home-link" |  |  Delete brief 
S/briefings/briefings-view.tsx:139 | "studio-icon-button" | aria-label="New briefing" title="New briefing" |  <Icon name="add" /> 
S/briefings/briefings-view.tsx:151 | "briefings-item" |  |  <span className="briefings-item-title"> {explanations[0]!.title} </span> <span className="briefings-item-meta
S/briefings/briefings-view.tsx:168 | "briefings-item" |  |  <span className="briefings-item-title">{entry.title}</span> <span className="briefings-item-meta"> {entry.kin
S/briefings/new-brief.tsx:62 | - | role="radio" |  {item.label} 
S/briefings/new-brief.tsx:92 | "studio-button primary" | disabled={!topic.trim() || busy} |  {busy ? "Building…" : "Build briefing"} 
S/command-palette.tsx:91 | "studio-palette-item" | aria-selected={index === selected} role="option" |  <Icon name={item.icon} /> <span>{item.label}</span> {item.shortcut && <kbd>{formatShortcut(item.s
S/documents/document-editor.tsx:343 | "dx-button" |  |  Retry 
S/documents/document-editor.tsx:455 | "dx-button" | disabled={busy} |  Confirm reviewed 
S/documents/document-editor.tsx:472 | "dx-button" | disabled={busy} |  Refresh source facts 
S/documents/document-editor.tsx:488 | "dx-button" | aria-expanded={menu === "revs"} |  <Icon name="history" size={17} /> Rev {shown} <Icon name="expand_more" size={16} /> 
S/documents/document-editor.tsx:500 | "dx-button" | disabled={busy || !canRegenerate} aria-expanded={menu === "regen"} |  <Icon name="auto_awesome" size={17} /> Regenerate 
S/documents/document-editor.tsx:511 | "dx-button dx-button-primary" | disabled={busy} aria-expanded={menu === "export"} |  <Icon name="download" size={17} /> Export 
S/documents/document-editor.tsx:537 | "dx-menu-item" | role="menuitem" |  <Icon name={ entry?.note.startsWith("Regenerated") ? "auto_awesome" : entry?.note.startsWith("Edited") ? "edi
S/documents/document-editor.tsx:583 | "dx-menu-item" | disabled={!fixable.length} role="menuitem" |  <Icon name="build" size={18} /> <span className="dx-grow"> <span className="dx-row-title"> Fix fiel
S/documents/document-editor.tsx:611 | "dx-menu-item" | role="menuitem" |  <Icon name="refresh" size={18} /> <span className="dx-grow"> <span className="dx-row-title">Regenerate every 
S/documents/document-editor.tsx:670 | "dx-menu-item dx-center" | role="menuitem" |  <Icon name={item.icon} size={18} /> <span className="dx-grow"> <span className="dx-row-title">{item.label}</s
S/documents/document-editor.tsx:758 | "dx-button dx-button-primary dx-button-xs" |  |  New with rev {profile.revision} 
S/documents/document-editor.tsx:789 | "dx-button dx-button-sm dx-self-start" |  |  Cancel 
S/documents/document-editor.tsx:805 | "dx-button dx-button-xs" |  |  Latest 
S/documents/document-editor.tsx:812 | "dx-button dx-button-ink dx-button-xs" | disabled={busy} |  Restore as rev {current + 1} 
S/documents/document-editor.tsx:870 | "dx-section-head" | aria-expanded={open} |  <Icon name={open ? "expand_more" : "chevron_right"} size={17} /> <span className="dx-grow dx-ellipsis"> {grou
S/documents/document-editor.tsx:1076 | "dx-icon-button" | aria-pressed={focus} aria-label={focus ? "Show fields" : "Focus on the document"} title={focus ? "Show fields" |  <Icon name={focus ? "left_pa
S/documents/documents-list.tsx:46 | "dx-button dx-button-sm" | aria-label={`Add document to ${group.title} title |  <Icon name="add" size={17} /> Add 
S/documents/documents-list.tsx:60 | "dx-doc-row" |  |  <Icon name={template ? KIND_ICON[template.kind] : "draft"} size={20} /> <span className="dx-grow"> <span clas
S/documents/documents-ui.tsx:48 | "dx-icon-button" | disabled aria-label={label} title={label} |  <Icon name={icon} /> 
S/documents/documents-ui.tsx:82 | - | aria-pressed aria-selected role |  {option.label} {option.count ? ( <span className="dx-count">{option.count}</span> ) : null} 
S/documents/documents-view.tsx:114 | "dx-button" |  |  Retry 
S/documents/documents-view.tsx:167 | "dx-button dx-button-primary dx-button-lg" |  |  <Icon name="add" /> New document 
S/documents/new-document-dialog.tsx:361 | "dx-button dx-button-lg" |  |  {busy ? "Cancel generation" : "Cancel"} 
S/documents/new-document-dialog.tsx:371 | "dx-button dx-button-primary dx-button-lg" | disabled={busy || !canGenerate} |  {busy ? <Spinner /> : <Icon name="auto_awesome" size={18} />} {busy ? "Generat
S/documents/new-document-dialog.tsx:415 | "dx-option" | aria-pressed={template.id === templateId} |  <span className="dx-option-line"> <Icon name={KIND_ICON[template.kind]} size={18} /> <span classNam
S/documents/new-document-dialog.tsx:474 | "dx-option dx-radio" | disabled={disabled} role="radio" |  <span className="dx-radio-dot" aria-hidden="true" /> <span className="dx-grow"> <span className="dx
S/documents/new-document-dialog.tsx:554 | "dx-option dx-stage" | aria-pressed={item.id === stage?.id} |  {item.label} 
S/documents/new-document-dialog.tsx:609 | "dx-button dx-button-sm" |  |  Open it 
S/documents/template-library.tsx:66 | "dx-button dx-button-lg" |  |  <Icon name="upload" /> Upload template 
S/documents/template-library.tsx:92 | "dx-table-row dx-table-body" | role="row" |  <span className="dx-cell-name" role="cell"> <Icon name={KIND_ICON[item.template.kind]} size={20} /> <span cla
S/documents/template-library.tsx:235 | "dx-button dx-button-sm dx-self-start" | disabled={busy || !detail} |  <Icon name="upload" size={16} /> Upload new version 
S/documents/template-library.tsx:281 | "dx-button dx-button-sm" | disabled={busy} |  Duplicate to customize 
S/documents/template-library.tsx:350 | "dx-button dx-button-primary dx-button-sm" | disabled={busy} |  Save as rev {current + 1} 
S/documents/template-library.tsx:472 | "dx-button" |  |  Cancel 
S/documents/template-library.tsx:475 | "dx-button dx-button-primary" | disabled={busy || !found} |  Save template 
S/documents/template-library.tsx:499 | "dx-dropzone" |  |  <Icon name="upload_file" size={26} /> <span className="dx-row-title">Choose a .docx or .md file</span> <span 
S/home/home-view.tsx:45 | "studio-button" |  |  <Icon name="add" /> New question 
S/home/home-view.tsx:53 | "studio-button primary" |  |  <Icon name="play_arrow" filled /> Start a rehearsal 
S/home/home-view.tsx:66 | - |  |  Retry 
S/home/home-view.tsx:99 | "studio-list-row home-continue-row" |  |  <span className="studio-list-title">{question.title}</span> <span className="studio-mono"> {question.language
S/home/home-view.tsx:134 | - |  |  Retry 
S/home/interview-card.tsx:69 | "home-link" |  |  Edit 
S/home/interview-card.tsx:216 | "studio-button" |  |  Cancel 
S/home/interview-card.tsx:220 | "studio-button primary" |  |  {plan ? "Save" : "Add interview"} 
S/home/plan-card.tsx:56 | "home-tick" | aria-label={`Done: ${item.title} title role="checkbox" |  {item.done && <Icon name="check" size={14} />} 
S/home/plan-card.tsx:78 | "studio-button home-open" |  |  Open 
S/home/plan-card.tsx:86 | "home-remove" | aria-label={`Remove ${item.title} title |  <Icon name="close" size={16} /> 
S/home/plan-card.tsx:126 | "studio-button" | aria-expanded={open} |  <Icon name="add" size={16} /> Add 
S/home/plan-card.tsx:153 | "ws-versions-item" | title role="menuitem" |  <Icon name="timer" size={16} /> <span>A timed rehearsal</span> 
S/home/plan-card.tsx:172 | "ws-versions-item" | title role="menuitem" |  <Icon name="terminal" size={16} /> <span>{question.title}</span> 
S/home/plan-card.tsx:193 | "ws-versions-item" | title role="menuitem" |  <Icon name="lightbulb" size={16} /> <span>{briefing.title}</span> 
S/live/answer-body.tsx:138 | "studio-button live-copy" |  |  <Icon name="content_copy" /> Copy answer 
S/live/claim-chips.tsx:46 | {`live-chip ${tone} | aria-expanded={open} title={meaning} |  {icon} {label} <Icon name={open ? "expand_less" : "expand_more"} /> 
S/live/coding-panel.tsx:139 | "live-coding-tab" | aria-selected={tab === each.id} role="tab" |  {each.label} 
S/live/coding-panel.tsx:292 | "studio-button" |  |  <Icon name="terminal" /> Open in Workspace 
S/live/end-confirm.tsx:71 | "studio-button live-bar-button" |  |  Keep going 
S/live/end-confirm.tsx:79 | "studio-button live-bar-button danger" | disabled={busy} aria-busy={busy} |  End session 
S/live/ended-history.tsx:66 | "studio-button" | aria-expanded={open} |  <Icon name="history" /> {open ? "Hide session history" : "Open session history"} 
S/live/ended-history.tsx:101 | "studio-button" | aria-label={`Open ${targetOf(session)} |  Open 
S/live/ended-history.tsx:116 | "studio-button" |  |  Try again 
S/live/ended-history.tsx:126 | "studio-button" | disabled={loading} |  Load more 
S/live/ended-results.tsx:29 | "studio-button" | aria-label={outcome ? `${label} |  <Icon name={ outcome === "copied" ? "check" : outcome === "failed" ? "error" : "content_copy" } /> {word} 
S/live/ended-results.tsx:126 | "studio-button" | aria-label={`Open ${row.title} title |  <Icon name="open_in_new" /> Open 
S/live/ended-retention.tsx:107 | "studio-button" | disabled={!shorter.includes(mode)} aria-pressed={mode === session.retention} |  {RETENTION_LABEL[mode]} 
S/live/ended-retention.tsx:145 | "studio-button ended-danger" |  |  <Icon name="delete" /> Delete permanently 
S/live/ended-retention.tsx:153 | "studio-button" |  |  Keep session data 
S/live/ended-retention.tsx:164 | "studio-button ended-danger" |  |  <Icon name="delete" /> Delete session data 
S/live/ended-retention.tsx:182 | "studio-button" |  |  <Icon name="refresh" /> Retry deletion 
S/live/ended-view.tsx:187 | "studio-button primary" |  |  <Icon name="add" /> Start another session 
S/live/ended-view.tsx:220 | "studio-button primary" |  |  <Icon name="add" /> Start a session 
S/live/live-view.tsx:45 | "studio-button" |  |  Try again 
S/live/overlay/auto-status.tsx:27 | "ov-link" |  |  Turn off 
S/live/overlay/code-canvas.tsx:310 | "lc-button" |  |  Switch 
S/live/overlay/code-canvas.tsx:313 | "lc-button" |  |  Keep mine 
S/live/overlay/code-canvas.tsx:321 | "lc-tab" | aria-selected={file === item.id} title={names[item.id]} role="tab" |  {item.label} {edited(item.id) && ( <span className="lc-dot" role="img" aria-label=
S/live/overlay/code-canvas.tsx:340 | "lc-button" | aria-pressed={wrap} |  Wrap 
S/live/overlay/code-canvas.tsx:349 | "lc-button" | aria-label={copyLabel(file, "Copy", "Copied")} title="Copy this file" |  <Icon name={copyIcon(file)} size={14} /> {!compact && copyLabel(file, "Copy"
S/live/overlay/code-canvas.tsx:360 | "lc-button" |  |  <Icon name={copyIcon("all")} size={14} /> {copyLabel("all", "Copy all", "Copied all")} 
S/live/overlay/code-canvas.tsx:365 | "lc-button lc-run" | disabled={!language || running} aria-label={running ? "Running…" : "Run"} title="Run solution, usage and tests |  <Icon name="play_arrow" si
S/live/overlay/code-canvas.tsx:390 | "lc-results-head" | aria-label={compact ? `Results: ${resultsSummary} aria-expanded={resultsOpen} |  <Icon name={resultsOpen ? "expand_more" : "expand_less"} size=
S/live/overlay/code-canvas.tsx:428 | "lc-tab" | aria-selected={panel === id} role="tab" |  {label} {count > 0 && <span className="ws-badge">{count}</span>} 
S/live/overlay/command-bar.tsx:72 | "ov-icon-button" | aria-label="Capture screen" title={tip( sharing ? "Capture & analyze this source" :  |  <Icon name="center_focus_strong" /> 
S/live/overlay/command-bar.tsx:84 | {`ov-icon-button ov-mic${listening ? " live" : ""} | aria-pressed={listening} aria-label={listening ? "Stop dictation" : "Dictate"} title={`${tip(listening ? "Stop 
S/live/overlay/command-bar.tsx:97 | {`ov-pill-button ov-auto-toggle${auto.on ? " on" : ""} | aria-pressed={auto.on} title={ auto.on ? "Auto is on: it listens and captures t |  <Icon name="visibility" 
S/live/overlay/command-bar.tsx:113 | "ov-pill-button" | title={tip("Interview topic: change it in settings", "se |  {skill ? LIVE_OWNER_SKILL_LABELS[skill] : "Topic: auto"} 
S/live/overlay/command-bar.tsx:122 | "ov-icon-button" | aria-label="Settings" title={tip("Settings and shortcuts", "settings")} |  <Icon name="settings" /> 
S/live/overlay/companion-setup.tsx:49 | "ov-link" | aria-expanded={open} |  Set up 
S/live/overlay/companion-setup.tsx:65 | "ov-icon-button" | aria-label={`Copy command: ${step.title} title="Copy the command" |  <Icon name={copied === step.id ? "check" : "content_copy"} /> 
S/live/overlay/companion-setup.tsx:79 | "ov-button" |  |  <Icon name="content_copy" /> {copied === "credential" ? "Copied" : "Copy credential"} 
S/live/overlay/device-only-notice.tsx:62 | "ov-link" |  |  Start a new session with remote allowed 
S/live/overlay/hands-free-controls.tsx:119 | "ov-link" |  |  Turn off 
S/live/overlay/hands-free-controls.tsx:159 | "ov-analyze stop" | disabled={hf.stopping} |  <Icon name="stop_circle" /> {hf.stopping ? "Stopping…" : "Stop analysis"} 
S/live/overlay/hands-free-controls.tsx:170 | "ov-analyze" | disabled={ hf.live.native === true || hf.deviceOnly || hf.p title={hf.live.native ? OWNER_APP_LINE : undefined |  <Icon name="center_focus_s
S/live/overlay/hands-free-controls.tsx:437 | "ov-segment" | aria-pressed={hf.live.auto === mode.on} title={mode.title} |  {mode.label} 
S/live/overlay/hands-free-controls.tsx:509 | "ov-icon-button" | aria-label={collapsed ? "Expand hands-free" : "Collapse hands aria-expanded={!collapsed} title={ collapsed ? " |  <Icon name={collapsed 
S/live/overlay/mask-editor.tsx:295 | "ov-preset" | aria-label={preset.label} title={preset.label} |  <Glyph rect={preset.rect} /> 
S/live/overlay/mask-editor.tsx:308 | "ov-button" |  |  Reset 
S/live/overlay/mask-editor.tsx:316 | "ov-button" |  |  Cancel 
S/live/overlay/mask-editor.tsx:319 | "ov-button primary" |  |  {display ? "Save & capture" : "Save region"} 
S/live/overlay/overlay-capture.tsx:142 | "ov-pill ov-pill-button" | title="Only the area you chose is captured. Press to cha |  <Icon name="crop" /> Cropped 
S/live/overlay/overlay-capture.tsx:239 | "ov-icon-button" | aria-label="Stop sharing" title="Stop sharing this source" |  <Icon name="stop_screen_share" /> 
S/live/overlay/overlay-capture.tsx:274 | "ov-analyze stop" | disabled={stopWork.stopping} aria-busy={stopWork.stopping} title="Stop the work that is running. The session s |  <Icon name="stop_circle" 
S/live/overlay/overlay-capture.tsx:288 | "ov-analyze" | disabled={disabled} aria-busy={busy || asking} aria-expanded={menuOpen} title={ deviceOnly ? DEVICE_ONLY_ANALY |  <Icon name="center_focus_stron
S/live/overlay/overlay-capture.tsx:347 | "ov-menu-item" | role="menuitem" |  <Icon name="add" /> <span className="ov-menu-text"> <span className="ov-menu-label"> New task from a fresh ca
S/live/overlay/overlay-capture.tsx:364 | "ov-menu-item" | role="menuitem" |  <Icon name="link" /> <span className="ov-menu-text"> <span className="ov-menu-label"> Attach a fresh capture 
S/live/overlay/overlay-capture.tsx:381 | "ov-menu-item" | role="menuitem" |  <Icon name="crop" /> <span className="ov-menu-text"> <span className="ov-menu-label">Choose area…</span> <spa
S/live/overlay/overlay-capture.tsx:403 | "ov-menu-item" | role="menuitem" |  <Icon name="screen_share" /> <span className="ov-menu-text"> <span className="ov-menu-label">{shareMenuCopy()
S/live/overlay/overlay-capture.tsx:418 | "ov-menu-item" | disabled={!companionReady || !stored} role="menuitem" |  <Icon name="desktop_windows" /> <span className="ov-menu-text"> <span className="ov-m
S/live/overlay/overlay-capture.tsx:436 | "ov-menu-item" | role="menuitem" |  <Icon name="link" /> <span className="ov-menu-text"> <span className="ov-menu-label"> Attach stored capture{s
S/live/overlay/overlay-capture.tsx:452 | "ov-menu-item" | disabled={!companionCanCapture} role="menuitem" |  <Icon name="visibility" /> <span className="ov-menu-text"> <span className="ov-menu-label">
S/live/overlay/overlay-capture.tsx:470 | "ov-menu-item" | role="menuitem" |  <Icon name="link" /> <span className="ov-menu-text"> <span className="ov-menu-label"> Attach the focused wind
S/live/overlay/overlay-capture.tsx:485 | "ov-menu-item" | disabled={!companionCanCapture} role="menuitem" |  <Icon name="crop" /> <span className="ov-menu-text"> <span className="ov-menu-label">Compan
S/live/overlay/overlay-capture.tsx:502 | "ov-menu-item" | role="menuitem" |  <Icon name="crop" /> <span className="ov-menu-text"> <span className="ov-menu-label">Choose area…</span> <spa
S/live/overlay/overlay-card.tsx:191 | "ov-icon-button ov-handle" | aria-label="Move card. Use the arrow keys; Home resets." title="Drag the header, or focus this and use the arr |  <Icon name="drag_in
S/live/overlay/overlay-card.tsx:214 | "ov-icon-button" | aria-label="Close overlay" title="Close this card and return to the previous view" |  <Icon name="close" /> 
S/live/overlay/overlay-card.tsx:226 | "ov-icon-button" | aria-label="Back to Studio" title="Close this window and return to Studio" |  <Icon name="close_fullscreen" /> 
S/live/overlay/overlay-card.tsx:255 | "ov-source" | aria-label={`${health?.label ?? source} aria-expanded={sourceOpen === source} title={`${health?.label ?? sourc |  <Icon name={SOURCE_ICON[source] ??
S/live/overlay/overlay-card.tsx:295 | "ov-icon-button" | aria-label="Details" title="Open the full dashboard: sources, credentials, re |  <Icon name="grid_view" /> 
S/live/overlay/overlay-card.tsx:304 | "ov-icon-button" | aria-pressed={maximized} aria-label={maximized ? "Restore" : "Maximize"} title={ maximized ? "Restore the comp |  <Icon name={maximized ? "clos
S/live/overlay/overlay-card.tsx:320 | "ov-icon-button" | aria-label="Float" title="Pop out into a floating window" |  <Icon name="open_in_new" /> 
S/live/overlay/overlay-card.tsx:351 | "ov-link" |  |  Open summary in Studio 
S/live/overlay/overlay-card.tsx:382 | "ov-link" |  |  Back to now 
S/live/overlay/overlay-card.tsx:398 | "ov-task-button" | aria-pressed={task.taskId === selected?.taskId} aria-label={`Task ${index + 1} |  T{index + 1} 
S/live/overlay/overlay-card.tsx:472 | "ov-button" |  |  <Icon name="content_copy" /> Copy answer 
S/live/overlay/overlay-footer.tsx:99 | "ov-send" | disabled={disabled || shown.trim() === ""} aria-label="Send follow-up" |  <Icon name="arrow_upward" /> 
S/live/overlay/overlay-footer.tsx:205 | { button.tone === "default" ? "ov-button" : `ov-button ${button.tone} | disabled={button.disabled} title={button.title} |  {button.icon && <Icon name={button.ic
S/live/overlay/overlay-footer.tsx:238 | "ov-button" |  |  Keep going 
S/live/overlay/overlay-footer.tsx:249 | "ov-button danger" | disabled={pending.includes("end")} |  End now 
S/live/overlay/overlay-page.tsx:121 | "ov-link" |  |  Start one in Studio 
S/live/overlay/overlay-task.tsx:239 | "ov-button" | disabled={!workspace} |  <Icon name="terminal" /> Open in Workspace 
S/live/overlay/overlay-task.tsx:271 | "ov-disclosure-head" | aria-expanded={open} |  <Icon name={open ? "expand_less" : "expand_more"} /> {icon && <Icon name={icon} />} <span className="ov-discl
S/live/overlay/panels/answer-pane.tsx:173 | "pn-primary" | disabled={!s.open} |  <Icon name="screenshot_monitor" /> {s.auto.on ? "Analyze screen" : "Capture screenshot"} <kbd>{nativeChord("a
S/live/overlay/panels/answer-pane.tsx:220 | "pn-mini-button" |  |  Back to {newest} 
S/live/overlay/panels/answer-pane.tsx:325 | "pn-mini-button" |  |  <Icon name={copying.copied === "answer" ? "check" : "content_copy"} /> {copying.copied === "answer" ? "Copied
S/live/overlay/panels/answer-pane.tsx:344 | "pn-note-close" | aria-label="Dismiss message" |  <Icon name="close" /> 
S/live/overlay/panels/code-card.tsx:93 | "pn-mini-button" |  |  <Icon name={copy.copied ? "check" : "content_copy"} /> {copy.copied ? "Copied" : copy.label} 
S/live/overlay/panels/code-card.tsx:105 | "pn-file-tab" | aria-pressed={shown === file.id} |  {file.name} 
S/live/overlay/panels/code-card.tsx:154 | "pn-linkbtn" |  |  Line {problem.line} {problem.column ? `:${problem.column}` : ""} 
S/live/overlay/panels/mini-player.tsx:80 | "pn-mini-button pn-mini-back" | title="Back to the normal window" |  <Icon name="close_fullscreen" /> Back to normal 
S/live/overlay/panels/mini-player.tsx:116 | "pn-mini-button" |  |  <Icon name="stop_circle" /> Stop analysis 
S/live/overlay/panels/mini-player.tsx:127 | "pn-mini-button" | disabled={pause.disabled} title={pause.title} |  {pause.icon && <Icon name={pause.icon} />} {pause.label} 
S/live/overlay/panels/panel-views.tsx:140 | "pn-copy" | aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy message"} |  <Icon name={copied ? "check" : "content_copy"} /> 
S/live/overlay/panels/panel-views.tsx:325 | "pn-jump" | aria-label="Jump to the latest" title="Jump to the latest" |  <Icon name="expand_more" /> {log.unseen > 0 ? `${log.unseen} new` : "Latest"} 
S/live/overlay/panels/panel-views.tsx:365 | "pn-round pn-mic" | disabled={!s.open} aria-pressed={recording} aria-label={recording ? "Stop microphone" : "Start microphone |  <Icon name="mic" filled={re
S/live/overlay/panels/panel-views.tsx:375 | "pn-round pn-send" | disabled={!s.open || s.draft.trim() === ""} aria-label="Send message" |  <Icon name="arrow_upward" /> 
S/live/overlay/panels/panel-views.tsx:432 | "pn-danger" |  |  Quit 
S/live/overlay/panels/panel-views.tsx:440 | "pn-danger" |  |  Close 
S/live/overlay/panels/panels-root.tsx:197 | "pn-bar-button" |  |  Review consent 
S/live/overlay/panels/popover.tsx:94 | {props.className} | disabled={lock !== null} aria-label={props.triggerLabel ?? props.label} aria-expanded={open} title={lock ?? pr |  {props.trigger} 
S/live/overlay/panels/screen-picker.tsx:75 | "pn-menu-item" | role="menuitemradio" |  <Icon name="check" style={{ opacity: row.checked ? 1 : 0 }} /> <span> <span className="pn-menu-label">{row.la
S/live/overlay/panels/screen-picker.tsx:90 | "pn-menu-item pn-display-item" | aria-label={`${row.name} role="menuitemradio" |  <Icon name="check" style={{ opacity: row.checked ? 1 : 0 }} /> <span clas
S/live/overlay/panels/start-panel.tsx:188 | "pn-bar-button" |  |  Try again 
S/live/overlay/panels/start-panel.tsx:371 | {`pn-menu-item${danger ? " pn-menu-danger" : ""} | role="menuitem" |  {icon} <span>{label}</span> 
S/live/overlay/panels/start-panel.tsx:448 | "pn-start-quiet" |  |  Try again 
S/live/overlay/panels/start-panel.tsx:455 | "pn-start-provider" | disabled={!ready.google} |  <span className="pn-start-mark pn-start-mark-g" aria-hidden="true"> G </span> Continue with Google 
S/live/overlay/panels/start-panel.tsx:467 | "pn-start-provider" | disabled={!ready.linkedin} |  <span className="pn-start-mark pn-start-mark-in" aria-hidden="true"> in </span> Continue with LinkedIn 
S/live/overlay/panels/start-panel.tsx:489 | "pn-start-local" |  |  <StartIcon name="laptop_mac" /> Continue on this Mac, no account 
S/live/overlay/panels/start-panel.tsx:537 | "pn-start-chip" |  |  <Icon name="open_in_new" /> Open browser again 
S/live/overlay/panels/start-panel.tsx:545 | "pn-start-chip" |  |  <Icon name="link" /> Copy link 
S/live/overlay/panels/start-panel.tsx:560 | "pn-start-quiet" |  |  Cancel 
S/live/overlay/panels/start-panel.tsx:606 | "pn-start-secondary" |  |  Back 
S/live/overlay/panels/start-panel.tsx:609 | "pn-start-primary" | disabled={working} |  Continue on this Mac 
S/live/overlay/panels/start-panel.tsx:746 | "pn-start-target" | role="radio" |  <Icon name={option.icon} /> <span className="pn-start-target-text"> <span className="pn-start-target-title">{
S/live/overlay/panels/start-panel.tsx:775 | "pn-start-agree" | role="checkbox" |  <StartIcon name={agreed ? "check_box" : "check_box_outline_blank"} /> <span>{AGREEMENT_TEXT}</span> 
S/live/overlay/panels/start-panel.tsx:787 | "pn-start-go" | disabled={block !== null || starting} |  {starting ? ( <span className="pn-start-spinner pn-start-spinner-light" aria-hidden="true" /> ) : (
S/live/overlay/panels/start-panel.tsx:813 | "pn-start-quiet" |  |  Review consent 
S/live/overlay/panels/start-panel.tsx:821 | "pn-start-link" |  |  Set up in Studio on the web 
S/live/overlay/panels/start-panel.tsx:850 | "pn-start-chip pn-start-allow" |  |  Allow… 
S/live/overlay/panels/status-strip.tsx:95 | "pn-task-chip" | aria-pressed={chip.selected} title={`Show ${chip.label} |  {chip.text} 
S/live/overlay/panels/status-strip.tsx:109 | { state.action.id === "resume" ? "ov-button go" : "pn-mini-button" } | title={state.action.title} |  {state.action.id === "stop" && <Icon name="stop_circle
S/live/overlay/panels/tests-drawer.tsx:25 | "pn-tests-handle" | aria-label="Tests" aria-expanded={open} title={open ? "Hide generated tests" : "Show generated t |  <span aria-hidden="true">{open ? "|<
S/live/overlay/panels/tests-drawer.tsx:65 | "pn-linkbtn" |  |  {failure.link.label} 
S/live/overlay/panels/toolbar.tsx:102 | {`pn-split-main${onOpenTargets ? " pn-joined" : ""} | disabled={lock !== null || !s.open || s.phase === "capturin aria-label={control.label} aria-expanded title
S/live/overlay/panels/toolbar.tsx:162 | "pn-bar-button pn-icon-button pn-mic-button" | disabled={lock !== null || !s.open || held} aria-pressed={recording} aria-label={name} title={ lock ?? (held ? | 
S/live/overlay/panels/toolbar.tsx:208 | "pn-bar-button pn-icon-button" | aria-pressed={glass.clear} aria-label={SEE_THROUGH_CONTROL.label} title={seeThroughTitle(glass.clear, passThro |  <Icon name={S
S/live/overlay/panels/toolbar.tsx:318 | "pn-menu-item" | disabled={item.disabledReason !== null} role={isMode ? "menuitemradio" : "menuitem"} |  <Icon name="check" style={{ opacity: item.checked ? 1 :
S/live/overlay/panels/toolbar.tsx:371 | "pn-menu-item" | role="menuitemradio" |  <Icon name="check" style={{ opacity: option.id === (s.skill ?? DEFAULT_SKILL) ? 1 : 0, }} /> {option.label} 
S/live/overlay/panels/toolbar.tsx:405 | "pn-bar-button pn-icon-button" | disabled={lock !== null || s.paused} aria-pressed={controls.panes.shown[pane.id]} aria-label={pane.label} titl |  <Icon name={p
S/live/overlay/panels/window-dots.tsx:132 | "pn-window-dot" | disabled={reason !== null} aria-label={control.label} aria-expanded={ control.action === "hide" ? undefined :  |  <span aria-hidden="true"
S/live/overlay/panels/window-dots.tsx:260 | "pn-mini-button" |  |  {QUIT_CONFIRMATION.cancel} 
S/live/overlay/panels/window-dots.tsx:268 | "pn-mini-button pn-quit-confirm" |  |  {QUIT_CONFIRMATION.confirm} 
S/live/overlay/panels/window-dots.tsx:367 | "pn-menu-item" | disabled={!available} role="menuitemradio" |  <Icon name="check" style={{ opacity: checked ? 1 : 0 }} /> <span> <span className="pn-menu-la
S/live/overlay/session-switcher.tsx:118 | "ov-icon-button" | disabled={!older || switching} aria-label="Previous session" title="Previous (older) session" |  <Icon name="keyboard_arrow_left" /> 
S/live/overlay/session-switcher.tsx:128 | "ov-switcher-current" | aria-expanded={open} |  <span className={`ov-dot ${tone}`} aria-hidden="true" /> <span className="ov-switcher-title"> {current?.title
S/live/overlay/session-switcher.tsx:149 | "ov-icon-button" | disabled={!newer || switching} aria-label="Next session" title="Next (newer) session" |  <Icon name="keyboard_arrow_right" /> 
S/live/overlay/session-switcher.tsx:170 | "ov-menu-item" | disabled={switching} role="menuitemradio" |  <span className={`ov-dot ${row.tone}`} aria-hidden="true" /> <span className="ov-menu-text"> <sp
S/live/overlay/session-switcher.tsx:189 | "ov-menu-item ov-menu-new" | disabled={blocked} title={ blocked ? "Only one session can be live at a tim role="menuitem" |  <Icon name="add" /> <span classNam
S/live/overlay/source-popover.tsx:48 | "ov-button" |  |  {action.label} 
S/live/pairing-panel.tsx:87 | "studio-button" | aria-pressed={shown} |  <Icon name={shown ? "visibility_off" : "visibility"} /> {shown ? "Hide" : "Show"} 
S/live/pairing-panel.tsx:96 | "studio-button" |  |  <Icon name="content_copy" /> Copy 
S/live/pairing-panel.tsx:119 | "studio-button" | disabled={busy} |  Renew 
S/live/pairing-panel.tsx:129 | "studio-button danger" | disabled={busy} |  {snapshot.session?.status === "active" ? "Revoke and pause" : "Confirm revoke"} 
S/live/pairing-panel.tsx:139 | "studio-button" |  |  Keep it 
S/live/pairing-panel.tsx:148 | "studio-button" | disabled={busy} |  Revoke 
S/live/pairing-panel.tsx:158 | "studio-button" |  |  Dismiss 
S/live/session-banner-list.tsx:51 | "live-banner-action" | disabled={busy} |  {copy.actionLabel} 
S/live/session-bar.tsx:225 | "studio-button live-bar-button" | disabled={presentationMode === "floating"} title="Pop out the capture controls into a floating wind |  <Icon name="picture_in_picture_alt
S/live/session-bar.tsx:237 | "studio-button live-bar-button" | title="Open the live session" |  Open 
S/live/session-bar.tsx:247 | "studio-button live-bar-button" | disabled={pauseBusy} aria-busy={pauseBusy} |  <Icon name={pauseFace.icon} filled /> {pauseFace.label} 
S/live/session-bar.tsx:258 | "studio-button live-bar-button danger" | disabled={endBusy} aria-busy={endBusy} aria-expanded={confirming} |  <Icon name="stop_circle" filled /> End 
S/live/session-draft-panel.tsx:86 | "studio-button" |  |  <Icon name="arrow_back" size={16} /> Back to session 
S/live/session-draft-panel.tsx:320 | "studio-button" | disabled={busy} |  Dismiss 
S/live/session-draft-panel.tsx:331 | "studio-button primary" | disabled={busy} |  Apply 
S/live/session-draft-panel.tsx:344 | "studio-button" |  |  Reload draft 
S/live/session-tabs.tsx:55 | "live-tab" | aria-selected={tab === entry.id} role="tab" |  {entry.label} {alerts[entry.id] && ( <span className="live-tab-dot" aria-hidden="true" /> )} 
S/live/setup-controls.tsx:53 | {`setup-segment${checked ? " on" : ""} | role="radio" |  {option.label} 
S/live/setup-controls.tsx:112 | {`setup-switch${on ? " on" : ""} | disabled={disabled} title role="switch" |  <span /> 
S/live/setup-footer.tsx:38 | "studio-button primary" | disabled={blocker !== null || pending} |  <Icon name="sensors" /> {pending ? "Starting…" : "Start session"} 
S/live/setup-sections.tsx:155 | "setup-link" |  |  Try again 
S/live/setup-sections.tsx:307 | "setup-link" |  |  Import one in Briefings 
S/live/setup-view.tsx:383 | "studio-button" |  |  Open it 
S/live/shared/capture-problem-banner.tsx:35 | "cp-button" |  |  {action.label} 
S/live/shared/capture-problem-banner.tsx:46 | "cp-close" | aria-label="Dismiss message" |  <Icon name="close" /> 
S/live/shared/crop-editor.tsx:151 | "ss-crop-handle" | aria-label={`Crop edge: ${handle.label} |  ))} </div> )} </div> {size && rect && ( <div className="ss-crop-fields"> {FIELDS.map(({ field, label }
S/live/shared/crop-editor.tsx:194 | "ss-btn" | disabled={busy || !size} |  Reset 
S/live/shared/crop-editor.tsx:202 | "ss-btn" | disabled={busy} |  Cancel 
S/live/shared/crop-editor.tsx:210 | "ss-btn primary" | disabled={busy || whole || !rect} |  {busy ? "Cropping..." : "Apply crop"} 
S/live/shared/image-viewer.tsx:202 | "ss-icon" | aria-label="Close viewer" |  <Icon name="close" /> 
S/live/shared/image-viewer.tsx:222 | "ss-icon" | aria-label="Zoom out" |  <Icon name="zoom_out" /> 
S/live/shared/image-viewer.tsx:233 | "ss-icon" | aria-label="Zoom in" |  <Icon name="zoom_in" /> 
S/live/shared/image-viewer.tsx:241 | "ss-btn" | aria-pressed={view.fit} |  Fit 
S/live/shared/image-viewer.tsx:249 | "ss-btn" | aria-pressed={!view.fit && view.scale === 1} |  100% 
S/live/shared/image-viewer.tsx:258 | "ss-btn" | disabled={cropDisabled} |  <Icon name="crop" /> Crop 
S/live/shared/missing-context-strip.tsx:78 | {look.button} | disabled={unavailable[action.id] !== undefined} |  {action.label} 
S/live/shared/revisions-control.tsx:100 | {look.item} | role="menuitemradio" |  <Icon name="check" style={{ opacity: entry.isSelected ? 1 : 0 }} /> <span> <span className={look.label}> rev 
S/live/shared/screenshots-area.tsx:48 | {VARIANT[variant].toggle} | aria-label={`Screenshots (${count} aria-expanded={tray.open} title={`${tray.open ? "Hide screenshots" : "Show  |  <Icon name="screen
S/live/shared/screenshots-area.tsx:81 | "ss-thumb" | aria-label={`Open ${shot.label} |  {shot.src ? ( <img src={shot.src} alt="" draggable={false} /> ) : ( <span className="ss-thumb-empty">No image
S/live/shared/screenshots-area.tsx:138 | "ss-icon" | aria-label="Scroll screenshots left" |  <Icon name="chevron_left" /> 
S/live/shared/screenshots-area.tsx:164 | "ss-icon" | aria-label="Scroll screenshots right" |  <Icon name="chevron_right" /> 
S/live/shared/screenshots-area.tsx:239 | "ss-icon" | disabled={busy || !shot.src} aria-label={`Crop ${shot.label} |  <Icon name="crop" /> 
S/live/shared/screenshots-area.tsx:248 | "ss-icon" | disabled={busy || index === 0} aria-label={`Move ${shot.label} |  <Icon name="arrow_back" /> 
S/live/shared/screenshots-area.tsx:257 | "ss-icon" | disabled={busy || index === staged.length - 1} aria-label={`Move ${shot.label} |  <Icon name="arrow_forward" /> 
S/live/shared/screenshots-area.tsx:266 | "ss-icon" | disabled={busy} aria-label={`Remove ${shot.label} |  <Icon name="delete" /> 
S/live/shared/screenshots-area.tsx:357 | "ss-btn" | disabled={addReason !== null} |  <Icon name="add" /> Add screenshot 
S/live/shared/screenshots-area.tsx:420 | "ss-btn primary" | disabled={!tray.canApply} |  {tray.failure === "request" ? "Retry" : "Apply"} 
S/live/shared/screenshots-area.tsx:430 | "ss-btn" | disabled={tray.applying} |  Discard 
S/live/sources-tab.tsx:62 | "studio-button" |  |  {label} 
S/live/sources-tab.tsx:77 | "studio-button" |  |  Cancel 
S/live/sources-tab.tsx:84 | "studio-button primary" |  |  {confirmLabel} 
S/live/sources-tab.tsx:176 | "studio-button" |  |  <Icon name="link" /> Pair capture companion 
S/live/task-panels.tsx:138 | "live-chip live-chip-button" | aria-pressed={task.taskId === selectedId} |  {taskLabel(number)} · {TASK_KIND[task.kind].label} 
S/live/task-panels.tsx:241 | "live-banner-action" |  |  Back to {newest} 
S/practice-timer.tsx:23 | {`ws-practice-button${running ? " running" : ""} | aria-label={running ? "Pause practice" : "Practise it out lou |  <Icon name={running ? "pause" : "mic"} filled /> 
S/rehearsal/live-session.tsx:111 | "studio-button" |  |  Start coding 
S/rehearsal/live-session.tsx:120 | "studio-button" |  |  <Icon name={session.paused ? "play_arrow" : "pause"} /> {session.paused ? "Resume" : "Pause"} 
S/rehearsal/live-session.tsx:129 | "studio-button primary" |  |  End session 
S/rehearsal/live-session.tsx:229 | {`rehearsal-check${on ? " on" : ""} | role="checkbox" |  <span className="box">{on && <Icon name="check" />}</span> {label} 
S/rehearsal/live-session.tsx:286 | - | disabled={locked} aria-expanded={open} |  <Icon name={open ? "visibility" : locked ? "lock" : "visibility_off"} /> <span>{reveal.label}</span> <span cl
S/rehearsal/live-session.tsx:326 | "studio-button" |  |  Ask a follow-up 
S/rehearsal/rehearsal-view.tsx:225 | {`rehearsal-format${on ? " on" : ""} | role="radio" |  <span className="rehearsal-format-head"> {item.title} {on && <Icon name="check_circle" />} </span> <span cla
S/rehearsal/rehearsal-view.tsx:259 | "studio-button" | aria-expanded={changing} |  {changing ? "Done" : "Change"} 
S/rehearsal/rehearsal-view.tsx:320 | "studio-button primary rehearsal-start" | disabled={starting || missingCoding} |  <Icon name="play_arrow" /> {starting ? "Loading questions…" : `Start ${format.t
S/rehearsal/rehearsal-view.tsx:352 | {`rehearsal-switch${on ? " on" : ""} | aria-label={title} title role="switch" |  <span /> 
S/rehearsal/scorecard.tsx:220 | "rehearsal-next" | title |  <Icon name={item.icon} /> <span> <span className="title">{item.title}</span> <span className="rehearsal-muted
S/rehearsal/scorecard.tsx:237 | "studio-button primary" |  |  Rehearse again 
S/rehearsal/scorecard.tsx:244 | "studio-button" |  |  Back to prep plan 
S/sidebar.tsx:63 | "studio-collapse" | aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"} title={expanded ? "Collapse sidebar" : "Expand s |  <Icon name={expanded ? "chevron_left" : "chevro
S/sidebar.tsx:74 | "studio-jump" |  |  <Icon name="search" /> <span>Search or jump to…</span> <kbd>{formatShortcut("mod+k")}</kbd> 
S/sidebar.tsx:82 | "studio-nav-item" | title={item.label} |  <Icon name={item.icon} filled={item.id === view} /> <span className="studio-nav-label">{item.label}</span> {i
S/sidebar.tsx:131 | - |  |  Retry 
S/sidebar.tsx:141 | "studio-recent-item" | title={question.title} |  <span className={`studio-dot ${runStatus(question).tone}`} aria-hidden="true" /> <span className="studio-rece
S/sidebar.tsx:180 | "studio-icon-button" | aria-label={theme === "dark" ? "Use light theme" : "Use dark  title="Toggle theme" |  <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} /> 
S/studio.tsx:488 | {`studio-button studio-assistant-toggle${host.open ? " open" : ""} | aria-pressed={host.open} title={`Assistant (${host.shortcut} |  <Icon name="auto_awesome" /> Assistant 
S/view-boundary.tsx:18 | "studio-button" |  |  Reload view 
S/workspace/assistant-change.tsx:60 | - |  |  Discard 
S/workspace/assistant-change.tsx:63 | "primary" |  |  Apply 
S/workspace/assistant-change.tsx:81 | - |  |  Undo 
S/workspace/code-panel.tsx:179 | "ws-file" | aria-selected={file === item.id} role="tab" |  <Icon name={item.icon} size={15} /> {names[item.id]} 
S/workspace/code-panel.tsx:192 | "ws-code-icon" | aria-label={copied ? "Code copied" : "Copy code"} title={copied ? "Code copied" : "Copy code"} |  <Icon name={copied ? "check" : "content_copy"} size=
S/workspace/code-panel.tsx:249 | "ws-panel-tab" | aria-selected={tab === id} role="tab" |  {label} {count > 0 && <span className="ws-badge">{count}</span>} 
S/workspace/code-panel.tsx:270 | "ws-code-icon" | aria-label={open ? "Collapse results" : "Expand results"} |  <Icon name={open ? "expand_more" : "expand_less"} /> 
S/workspace/code-panel.tsx:353 | "ws-test-action" |  |  Go to line {test.location.line} {test.location.editor === "solution" ? " (solution)" : ""} 
S/workspace/new-question.tsx:76 | "studio-button" | disabled={!ready} |  Solve it myself 
S/workspace/new-question.tsx:84 | "studio-button primary" | disabled={!ready} |  <Icon name="auto_awesome" /> {busy ? "Drafting…" : "Draft with assistant"} 
S/workspace/new-question.tsx:117 | "ws-example-card" | disabled={busy} |  <span>{example.answer.title}</span> <span className="ws-mono"> {LANGUAGE_LABELS[example.language]} </span> 
S/workspace/stage-panes.tsx:54 | "studio-button" |  |  <Icon name="chevron_left" /> {previous.label} 
S/workspace/stage-panes.tsx:65 | "studio-button ws-next" |  |  Next: {next.label} <Icon name="chevron_right" /> 
S/workspace/stage-panes.tsx:160 | {`ws-check${done ? " done" : ""} | role="checkbox" |  <span className="ws-box"> {done && <Icon name="check" size={12} />} </span> <span> <InlineText>{item}</Inline
S/workspace/versions-menu.tsx:44 | "studio-button" | aria-expanded={open} |  Versions <Icon name="expand_more" size={16} /> 
S/workspace/versions-menu.tsx:59 | "ws-versions-save" | disabled={disabled} role="menuitem" |  <Icon name="add" size={16} /> Save this version 
S/workspace/versions-menu.tsx:89 | "ws-versions-item" | title={`Restore — ${formatTimestamp(version.updatedAt)} role="menuitem" |  <span>{version.title}</span> <span className="ws-faint"> {formatRel
S/workspace/workspace-view.tsx:420 | "studio-button ws-new-question" | title="New question (N)" |  <Icon name="add" /> New question 
S/workspace/workspace-view.tsx:460 | {`ws-step ${state} | title={item.hint} |  <span className="ws-step-dot"> {state === "warn" ? ( <Icon name="priority_high" size={14} /> ) : state === "d
S/workspace/workspace-view.tsx:491 | "studio-button" |  |  Reload 
S/workspace/workspace-view.tsx:505 | "studio-button ws-run" | disabled={!answer?.code.trim() || run.kind === "running"} title="Run tests (⌘↵)" |  <Icon name="play_arrow" filled /> Run tests <kbd>�
products/presentation/src/frontend/index.tsx:242 | {`presentation-reference-theme ${selected ? "selected" : ""} |  |  <span className="presentation-reference-theme-preview"> <strong>Title</strong> <sp
products/presentation/src/frontend/index.tsx:397 | "presentation-reference-pill presentation-reference-pill-button" |  |  <span aria-hidden="true">✣</span>More 
products/presentation/src/frontend/index.tsx:425 | "presentation-reference-submit" | aria-label="Create presentation" |  → 
products/presentation/src/frontend/index.tsx:444 | {tab === id ? "active" : ""} |  |  {label} 
products/presentation/src/frontend/index.tsx:461 | - |  |  ＋ Create new 
products/presentation/src/frontend/index.tsx:464 | - | aria-pressed={sortByTitle} aria-label="Sort presentations by title" title |  A–Z 
products/presentation/src/frontend/index.tsx:472 | {!listView ? "active" : ""} |  |  ▦ Grid 
products/presentation/src/frontend/index.tsx:479 | {listView ? "active" : ""} |  |  ☷ List 
products/presentation/src/frontend/index.tsx:503 | - | aria-label={`${item.favorite ? "Remove" : "Add"} title |  {item.favorite ? "★" : "☆"} 
products/presentation/src/frontend/index.tsx:547 | "presentation-reference-help" | aria-label="Help" |  ? 
products/presentation/src/frontend/index.tsx:746 | - | disabled={ !topic.trim() || status === "Generating outline… |  ⟳ Regenerate 
products/presentation/src/frontend/index.tsx:772 | {textContent === option.id ? "selected" : ""} |  |  <span className="presentation-reference-lines"> {Array.from({ length: option.lines }).map((_, ind
products/presentation/src/frontend/index.tsx:862 | - | disabled={status === "Creating…"} |  Create presentation 
products/presentation/src/frontend/index.tsx:870 | - | disabled={ !topic.trim() || status === "Generating outline… |  ✣ Generate Outline 
products/presentation/src/frontend/index.tsx:881 | - | aria-label="Help" |  ? 
products/presentation/src/frontend/index.tsx:1431 | "presentation-editor-icon-button" | aria-label="Open presentation menu" |  ☰ 
products/presentation/src/frontend/index.tsx:1454 | - |  |  Theme 
products/presentation/src/frontend/index.tsx:1462 | - |  |  Export 
products/presentation/src/frontend/index.tsx:1479 | - |  |  ＋ New Presentation 
products/presentation/src/frontend/index.tsx:1487 | - | title |  ✎ Rename 
products/presentation/src/frontend/index.tsx:1499 | - |  |  Share presentation 
products/presentation/src/frontend/index.tsx:1502 | - |  |  Duplicate presentation 
products/presentation/src/frontend/index.tsx:1525 | - |  |  Revoke share link 
products/presentation/src/frontend/index.tsx:1530 | - | disabled={undoSources.length === 0} |  ↶ Undo 
products/presentation/src/frontend/index.tsx:1537 | - | disabled={redoSources.length === 0} |  ↷ Redo 
products/presentation/src/frontend/index.tsx:1545 | - |  |  ⚙ Page Setup 
products/presentation/src/frontend/index.tsx:1554 | - |  |  ◈ Theme Panel 
products/presentation/src/frontend/index.tsx:1564 | - |  |  ← Back to prompt 
products/presentation/src/frontend/index.tsx:1572 | - |  |  ▦ All Presentations 
products/presentation/src/frontend/index.tsx:1588 | - | aria-label={`Select slide ${slide.position + 1} |  <span>{slide.position + 1}</span> <div> <SlideBlockView source={slide.sourceXml} appearance={
products/presentation/src/frontend/index.tsx:1603 | - | disabled={slide.position === 0} aria-label={`Move slide ${slide.position + 1} |  ↑ 
products/presentation/src/frontend/index.tsx:1611 | - | disabled={slide.position === document.slides.length - 1} aria-label={`Move slide ${slide.position + 1} |  ↓ 
products/presentation/src/frontend/index.tsx:1622 | "presentation-reference-add-slide" | aria-label="Add slide" |  ＋ 
products/presentation/src/frontend/index.tsx:1666 | "studio-primary-action" |  |  Save slide 
products/presentation/src/frontend/index.tsx:1673 | - | disabled={document.slides.length <= 1} |  Delete slide 
products/presentation/src/frontend/index.tsx:1701 | {activePanel === panel ? "is-active" : ""} | aria-label={label} |  <span>{icon}</span> <small>{label}</small> 
products/presentation/src/frontend/index.tsx:1734 | - | aria-label="Close panel" |  × 
products/presentation/src/frontend/index.tsx:1781 | "presentation-reference-card" |  |  <span className="presentation-reference-card-preview"> {type === "CHART" ? "◔" : type === "DIAGRAM" ? "⌁" : 
products/presentation/src/frontend/index.tsx:1817 | - | disabled={!slidePrompt.trim()} |  Generate slide 
products/presentation/src/frontend/index.tsx:1832 | - | disabled={!selected || !agentPrompt.trim()} |  Run presentation agent 
products/presentation/src/frontend/index.tsx:1841 | - |  |  Cancel agent 
products/presentation/src/frontend/index.tsx:1844 | - |  |  Resume with prompt 
products/presentation/src/frontend/index.tsx:1851 | "studio-primary-action" |  |  Apply staged result 
products/presentation/src/frontend/index.tsx:1872 | - | aria-label="Close panel" |  × 
products/presentation/src/frontend/index.tsx:1927 | - | aria-label="Close panel" |  × 
products/presentation/src/frontend/index.tsx:1949 | "presentation-reference-theme-option" |  |  <span style={{ background: String( theme.definition["background"] ?? "#24205a", ), color: String(theme.d
products/presentation/src/frontend/index.tsx:1984 | - | aria-label="Close panel" |  × 
products/presentation/src/frontend/index.tsx:2004 | - |  |  − 
products/presentation/src/frontend/index.tsx:2011 | - |  |  ＋ 
products/presentation/src/frontend/index.tsx:2017 | - | aria-label="Help" |  ? 
products/presentation/src/frontend/index.tsx:2031 | - | aria-label="Close export" |  × 
products/presentation/src/frontend/index.tsx:2040 | - |  |  Export PPTX 
products/presentation/src/frontend/index.tsx:2049 | - |  |  Export PDF 
products/presentation/src/frontend/index.tsx:2219 | "studio-primary-action" |  |  Save theme 
products/presentation/src/frontend/index.tsx:2251 | - |  |  {theme.favorite ? "★ Favorited" : "☆ Favorite"} 
products/presentation/src/frontend/index.tsx:2257 | - |  |  {theme.liked ? "♥ Liked" : "♡ Like"} 
products/presentation/src/frontend/index.tsx:2376 | "studio-primary-action" | disabled={!prompt.trim()} |  Generate 
products/presentation/src/frontend/index.tsx:2536 | - | disabled={index === 0} |  Previous 
products/presentation/src/frontend/index.tsx:2546 | - | disabled={!document || index >= document.slides.length - 1} |  Next 
products/presentation/src/frontend/index.tsx:2556 | - |  |  {recording ? "Stop recording" : "Record"} 
products/presentation/src/frontend/index.tsx:2621 | - | disabled={index === 0} |  Previous 
products/presentation/src/frontend/index.tsx:2631 | - | disabled={!document || index >= document.slides.length - 1} |  Next 
products/presentation/src/frontend/slide-blocks.tsx:63 | - |  |  Bold 
products/presentation/src/frontend/slide-blocks.tsx:66 | - |  |  Italic 
products/presentation/src/frontend/slide-blocks.tsx:69 | - |  |  Code 
products/presentation/src/frontend/slide-blocks.tsx:141 | - |  |  Remove 
products/presentation/src/frontend/slide-blocks.tsx:146 | - |  |  Add content block ```
