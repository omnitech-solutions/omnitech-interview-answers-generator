# Slice 4: what is left (2026-10-06)

Slice 4 migrated all 74 `.studio-button` sites outside the live session bar to the shared `Button` (about 750 changed lines, under the 1000-line checkpoint) and stopped there. Still on raw `<button>` in `products/interview/src/frontend/studio/` (outside `live/overlay/`): 142 sites.

## 1. `.studio-button` itself (delete the rule when these move)
The one remaining definition is `studio/tokens.css` (rule, `:hover`, `:disabled`; merged from the old `studio-base.css:252` block) plus `studio/live/live.css` `.live-session-bar .studio-button { min-height: 40px }`. Remaining users, owned by the session-bar slice:
- `studio/live/session-bar.tsx:227,239,249,261` (`studio-button live-bar-button`, last one `danger`)
- `studio/live/end-confirm.tsx:74,82` (`studio-button live-bar-button`, last one `danger`)
When both files are migrated: delete the rule from `tokens.css`, the `live.css` rule, the `.live-bar-button*` rules in `live/session-bar.css:118-142`, and set `LEGACY_USERS = []` in `ui/studio-button-retired.test.ts` (then drop that test's second assertion's expected list).

## 2. Documents (`dx-button`, `dx-icon-button`; CSS `documents/documents.css:81-117, 343, 549-550`)
- `documents/template-library.tsx:68,237,283,352,472,477`
- `documents/document-editor.tsx:345,457,474,490,502,513,760,791,807,814` and `dx-icon-button` at `:1078`
- `documents/new-document-dialog.tsx:363,373,611` (373 already has the only Spinner/busy pattern: use `loading`)
- `documents/documents-view.tsx:116,169`; `documents/documents-list.tsx:48`; `documents/documents-ui.tsx:50` (`dx-icon-button`)
Map: `dx-button` secondary md, `-sm` sm, `-xs` sm, `-lg` lg, `-primary` primary, `-ink` primary, `dx-icon-button` ghost icon, `data-active` becomes `pressed`.

## 2b. Other Studio families (not `.studio-button`)
- `.studio-icon-button` (`studio/tokens.css:~366`): `sidebar.tsx`, `account/welcome-banner.tsx`, `briefings/briefings-view.tsx`, `behavioural-pack.tsx`, `briefing-tabs.tsx`, `questions-card.tsx`: ghost, size icon.
- `bp-*` (`bp-link`, `bp-back`, `bp-accept`, `bp-source`, `bp-matrix-button`), `home-link`, `home-remove`, `home-tick`, `library-*`, `ws-*` (code-icon, file, tab, check, example-card), `rehearsal-*` (check, format, switch), `practice-timer.tsx`, `setup-*` links/switch/segment, `live-chip-button`, `live-tab`: links go to `link`, chips/tabs/switches wait for the Chip/Tab/Switch primitives.
- Plain `<button>` still in migrated files (not `.studio-button`): `home/plan-card.tsx` (5), `briefings/behavioural/matrix-picker.tsx` (6), `answers-tab.tsx` (5), `workspace/code-panel.tsx` (5), `setup-card.tsx` (4), `assistant-change.tsx` (3).
- `live/shared/*` (screenshots-area 11, image-viewer 6, crop-editor 4): `ss-btn`, another family.

## Other notes
- `layout-rules.test.ts` now also requires every `<Button` in `live/*.tsx` to be `size="lg"` (40 px).
