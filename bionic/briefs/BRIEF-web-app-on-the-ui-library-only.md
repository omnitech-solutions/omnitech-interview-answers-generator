---
title: "The web app on the UI library only: audit and migration plan"
slug: web-app-on-the-ui-library-only
type: brief
status: draft
created_at: 2026-10-10
updated_at: 2026-10-10
authors: ["desoleary", "claude"]
tags: [ui-library, web, studio, presentation, dynamic-form, migration, audit]
related_adrs: [ADR-0002, ADR-0003, ADR-0004, ADR-0019, ADR-0033]
---

# The web app on the UI library only: audit and migration plan

## Problem

The owner asked what it takes for the web app to be built solely from
`@oc-tech/omni-ui-components`, the way the native window was, with forms declared through the
library's DynamicForm. This brief is the audit and the plan. No source code was changed.

The standing rules the plan is written to:

- UI is built only from library parts: no custom CSS, no inline styles, no raw `div`/`span`
  layouts in the app.
- When the library lacks something, the library is extended first (generic, typed, with stories
  and tests) and re-vendored into `vendor/omni-ui-components`. The app never works around a gap.
- Forms are the library's schema-driven DynamicForm, not hand-built forms.
- `apps/web` is a thin shell; `products/*` own their frontend (AGENTS.md rules 3 and 4).

## What the audit found, in short

| Finding | Number |
|---|---|
| Pages a person can reach | 22 (7 in the shell, 8 in Interview Studio, 7 in Presentation), plus 2 redirects |
| States screenshotted | 38, each dark and light at two widths: 152 images |
| App stylesheets | 29 files, 11,939 lines, 2,087 rules |
| Raw HTML elements in app TSX | 2,473 (1,363 layout, 450 text, 270 buttons and links, 209 form, 131 list, 42 svg and media, 8 table) |
| `className` uses | 1,747 |
| Inline `style` uses | 75 |
| Raw `<form>` elements | 8; raw `input`, `select` and `textarea` fields: 81 |
| `<DynamicForm>` uses | 0, on the web and in the native window |
| Library `Table` uses | 0 |
| TSX files that import the library | 64 of 142 |
| Other UI packages | CodeMirror (3 files), `@omnitech-assistant/react` (5), `react-markdown` (1), `@panzoom/panzoom` (1) |

Counting only what the web shows (everything except the native overlay, the native interview
brief form and the native sign-in): 25 stylesheets with 9,968 lines, 1,513 `className` uses,
29 inline styles, and 36 of 102 TSX files importing the library.

Three things the owner should know before reading the plan:

1. **The native window does not use DynamicForm.** Nothing in this repository does. Its forms are
   controlled library fields (`Input`, `Select`, `Textarea`) held in `useState`. The first
   DynamicForm anywhere will be written by this migration.
2. **"Library parts only" is true for four native files, not the whole native window.** The
   interview brief form, its lists, the pack review and the context pane have no `className`, no
   `style` and no raw layout element. The rest of the overlay still has 4 stylesheets
   (1,971 lines), 234 `className` uses and 46 inline styles.
3. **A page with no custom CSS cannot be laid out with the library as it is today.** It has
   `Flex`, `Space`, `Splitter`, `Panel` and `Card`, but no page container, no responsive grid, no
   app shell with a collapsing sidebar, no heading levels and no scroll area. Those come first.

## The approach taken with the native app

Sources: `products/interview/src/frontend/studio/live/overlay/`,
`products/interview/src/frontend/studio/interview-brief/`, `bionic/inbox/redesign/native-ui-swap-plan.md`,
`native-worker-rules.md`, `native-rework-report.md`, `ui-components/plan.md`, and OBJ-11 in
`bionic/objectives.md`.

| Question | What was done |
|---|---|
| Which parts it composes | From the root entry: `Button`, `IconButton`, `SplitButton`, `Toolbar`, `ActionMenu`, `Panel`, `Splitter`, `Tabs`, `Tag`, `Empty`, `Divider`, `Steps`, `Progress`, `SessionBar`, `StatusClock`, `Transcript`, `HeardLine`, `CueCard`, `OutlineList`, `Collapse`, `Descriptions`, `Card`, `Alert`, `Modal`, `Popover`, `Popconfirm`, `Input`, `Select`, `Textarea`, `Checkbox`, `SegmentedPrimitive`, `FileUpload`, `Flex`, `Space`, `Typography`. From `./highlight`: `highlightLines`. The `./native`, `./chat` and `./dynamic-form` entries are not imported. |
| Layout without custom CSS | In the clean files: `Flex` (`vertical`, `gap`, `wrap`), `Space`, `Card`, `Collapse`, `Descriptions`, `Divider`, and `Panel` (header, scrolling body, dock) inside `Splitter`. |
| How forms are declared | Hand-composed library fields with a `label`, `description`, `error`, `options` and a value-first `onChange`; drafts in `useState`; validation inline. The closest thing to a schema is the Settings pane, which maps the `BEHAVIOUR_FLAGS` table to one `Select` per flag. |
| Theming | The library stylesheet is imported once in `apps/web/app/layout.tsx`. The library follows `data-theme` on the page. `ui/theme.css` (13 lines) only sets the panel see-through value. |
| How it is tested | Component tests select by role, title, `data-slot` and test id. `context-pane.source.test.ts` fails on `style=`, `className=`, a colour literal, a `.css` import or a raw `div`/`span`/`p`/`section` in that one file. `scripts/ui-migration-audit.test.ts` runs in `pnpm verify`: retired class families cannot return, and raw `button`/`input`/`select`/`textarea`/`dialog`/`table` are capped per file by an allow-list where every entry has a reason and may only shrink. The browser suite's `e2e/live-session/src/claims/claims.ts` lists every control with what it claims and the effect that proves it; `claims-coverage.spec.ts` fails on a control that is not listed. |
| The two rules of the swap | Old UI goes (component and its CSS deleted in the same change). Behaviour stays (every behaviour gets a test against the old component first, then the swap). |
| What was added to the library | New: `Toolbar`, `SplitButton`, `ActionMenu`, `Panel`, `Transcript`, `SessionBar`, `StatusClock`, `CueCard`, `HeardLine`, `useFollowLatest`. Variations: `Button` (`tone`, control size, `shortcut`, `loading`, `pressed`, `soft`, `asChild`), `IconButton` (`tone`, `pressed`, `badge`, `disabledReason`), `Progress` ring, `Segmented` multiple, `Empty` tile and compact, `Steps` checklist, `Tag` mono and copy, `Collapse` (description, small, accent), `Descriptions` (unbordered, small), `Typography` tones and compact, control and tone tokens, see-through. |
| Re-vendoring | By hand, from `vendor/README.md`: build and `pnpm pack` in `../omni-ui-components/packages/core`, replace the tarball under the same name, `pnpm install`. There is no script, and the tarball does not record the commit it was packed from. |
| Where the rule is written | OBJ-11 says the panels are "built only from the shared component library". The stricter rule (extend the library first, no custom CSS) lives in a test comment and commit messages. It is not in `AGENTS.md` and no ADR covers it. |

The approach to copy, stated as rules for the web:

1. Find the library part first. If none fits, add or extend it in the library, with a story that
   uses generic names and typed data, then re-vendor.
2. Write the behaviour tests against the old page, then swap, then delete the old component and
   its stylesheet in the same change.
3. A migrated file is locked by the audit: zero raw elements, zero `className`, zero `style`.
4. Selectors in tests move from classes to roles, names and `data-slot`.

## How the numbers and screenshots were produced

**Numbers.** `bionic/briefs/assets/web-library-only/inventory.mjs` reads git-tracked files only,
skips tests, stories, `testing/` fixtures and generated icons, strips comments, and counts by
regular expression. Its output is saved as `inventory.md` beside it.

```bash
node bionic/briefs/assets/web-library-only/inventory.mjs          # Markdown tables
node bionic/briefs/assets/web-library-only/inventory.mjs --json   # the same as JSON
```

The counts are textual, so they are a measure and not a parse. A lowercase JSX tag is counted when
it is a known HTML or SVG element name and follows a non-identifier character.

**Screenshots.** `web-pages.spec.ts` and `playwright.config.ts` in the same folder run on the
browser suite's own stack: a disposable PostgreSQL container, its own `next build` in
`apps/web/.next-e2e-libonly`, a free loopback port, the fake sign-in and the scripted model.
`http://localhost:3000` was never opened. The config reuses `e2e/live-session/playwright.config.ts`
and its global setup and changes only where the spec lives.

```bash
pnpm build     # once; the suite loads packages from dist
cd e2e/live-session && E2E_DIST_DIR=.next-e2e-libonly pnpm exec playwright test \
  --config ../../bionic/briefs/assets/web-library-only/playwright.config.ts
```

Each state is taken at 1280 and 480 wide (the native panel at 1320 and 760), dark and light, as a
viewport JPEG at quality 55. The folder holds 152 images in 4.2 MB. `shots/shots.json` lists each
image, the address it landed on and any page the spec could not reach. The spec asserts nothing
and never fails on an unreachable page.

**Storybook.** The owner's Storybook on port 6006 was read through its story index only
(`/index.json`, 184 titles, 1,044 entries); nothing was started or stopped. The browser pane
refused to open it, so the three named pages were read from source:
`.storybook/getting-started/ComponentOverview.stories.tsx`, `TableOverview.stories.tsx` and
`packages/core/src/dynamic-form/DynamicForm/DynamicForm.stories.tsx`. The library was at commit
`f208942` with a clean tree.

## Page inventory

Screenshot links are in the order desktop dark, desktop light, narrow dark, narrow light. All
paths are under `assets/web-library-only/shots/`. "Non-library uses" are from `inventory.mjs` for
the source folder that draws the page. Effort is for one worker and includes tests: S is up to
2 days, M 3 to 4, L 5 to 7, XL 8 to 10.

### Shell pages (`apps/web`)

Source: `apps/web/app/**` and `src/platform/platform-shell.tsx`. 16 TSX files, 689 lines; 1
stylesheet of 645 lines and 92 rules; 21 layout, 19 text, 6 form and 4 control elements; 26
`className`; 5 inline styles; 2 raw forms; no file imports a library part.

| Page | Screenshots | What it has now | Library replacement | Gaps | Effort |
|---|---|---|---|---|---|
| `/sign-in` (also `?reason=expired`, `?next=`) | [dd](assets/web-library-only/shots/01-sign-in-desktop-dark.jpg) [dl](assets/web-library-only/shots/01-sign-in-desktop-light.jpg) [nd](assets/web-library-only/shots/01-sign-in-narrow-dark.jpg) [nl](assets/web-library-only/shots/01-sign-in-narrow-light.jpg); expired: [dd](assets/web-library-only/shots/02-sign-in-expired-desktop-dark.jpg) [dl](assets/web-library-only/shots/02-sign-in-expired-desktop-light.jpg) [nd](assets/web-library-only/shots/02-sign-in-expired-narrow-dark.jpg) [nl](assets/web-library-only/shots/02-sign-in-expired-narrow-light.jpg) | `auth-*` classes (37 rules), three `<form action>` with hidden inputs, raw buttons, a hand-made "or" divider | `Card`, `Typography`, `Button` (`type="submit"`, leading icon, disabled with a reason), `Alert` (info, warning), `Divider` "With Label" | G1 centred page container; G3 heading level; G12 theme follows the system; G13 client boundary. The `<form action>` stays: it is a server action with no fields, so it goes on the allow-list | S |
| `/signed-out` | [dd](assets/web-library-only/shots/03-signed-out-desktop-dark.jpg) [dl](assets/web-library-only/shots/03-signed-out-desktop-light.jpg) [nd](assets/web-library-only/shots/03-signed-out-narrow-dark.jpg) [nl](assets/web-library-only/shots/03-signed-out-narrow-light.jpg) | `auth-card`, raw link styled as a button | `Result` with an action `Button asChild` around the link | G1 | S |
| `/native/sign-in` | [dd](assets/web-library-only/shots/04-native-sign-in-desktop-dark.jpg) (redirected to `/sign-in`; see "Not reached") | 43 lines, no markup of its own | none needed | none | none |
| `/share/presentation/:token` | [dd](assets/web-library-only/shots/05-share-presentation-unknown-token-desktop-dark.jpg) [dl](assets/web-library-only/shots/05-share-presentation-unknown-token-desktop-light.jpg) [nd](assets/web-library-only/shots/05-share-presentation-unknown-token-narrow-dark.jpg) [nl](assets/web-library-only/shots/05-share-presentation-unknown-token-narrow-light.jpg) | Drawn by Presentation's `SharedPresentation` | See Presentation | See Presentation | with Presentation |
| `/t/:tenant/settings/integrations` | [dd](assets/web-library-only/shots/10-settings-integrations-desktop-dark.jpg) [dl](assets/web-library-only/shots/10-settings-integrations-desktop-light.jpg) [nd](assets/web-library-only/shots/10-settings-integrations-narrow-dark.jpg) [nl](assets/web-library-only/shots/10-settings-integrations-narrow-light.jpg) | `platform-*` classes, two hand-made cards with links; no navigation, no way back | `IntegrationList` (story "O Auth Accounts") from `./chat`, inside the page container | G1, G2 page header | S |
| Not found (`/no-such-page`, unknown product) | [dd](assets/web-library-only/shots/06-not-found-desktop-dark.jpg) [dl](assets/web-library-only/shots/06-not-found-desktop-light.jpg); unknown product: [dd](assets/web-library-only/shots/11-unknown-product-desktop-dark.jpg) [dl](assets/web-library-only/shots/11-unknown-product-desktop-light.jpg) | Next.js default page; the app has no `not-found.tsx` | `Result` with a link home | G1 | S |
| `global-error.tsx` | not reachable on demand | 5 inline styles, raw `button`, no stylesheet on purpose | Do not migrate (see "What should not be migrated") | none | none |
| `PlatformShell` frame | on every tenant page | One `div` and one `main` with `platform-frame-*` classes | `Layout` and `Content`, or nothing: each product brings its own shell | G4 | S |

`styles.css` in `apps/web` also holds 34 `.studio-*` and 4 `.presentation-*` rules. A thin shell
should hold none; they move or go with the product steps.

### Interview Studio (`products/interview`)

| Page | Screenshots | Non-library uses | Library replacement | Gaps | Effort |
|---|---|---|---|---|---|
| Studio shell on every view: sidebar, header, command palette, account menu, sign-out dialog, Assistant dock | palette: [dd](assets/web-library-only/shots/21-home-command-palette-desktop-dark.jpg) [dl](assets/web-library-only/shots/21-home-command-palette-desktop-light.jpg) [nd](assets/web-library-only/shots/21-home-command-palette-narrow-dark.jpg) [nl](assets/web-library-only/shots/21-home-command-palette-narrow-light.jpg); account: [dd](assets/web-library-only/shots/22-home-account-menu-desktop-dark.jpg) [dl](assets/web-library-only/shots/22-home-account-menu-desktop-light.jpg) [nd](assets/web-library-only/shots/22-home-account-menu-narrow-dark.jpg) [nl](assets/web-library-only/shots/22-home-account-menu-narrow-light.jpg); Assistant: [dd](assets/web-library-only/shots/23-home-assistant-desktop-dark.jpg) [dl](assets/web-library-only/shots/23-home-assistant-desktop-light.jpg) [nd](assets/web-library-only/shots/23-home-assistant-narrow-dark.jpg) [nl](assets/web-library-only/shots/23-home-assistant-narrow-light.jpg) | 15 TSX, 1,740 lines; 4 CSS files, 1,296 lines (`tokens.css` 703, `studio-base.css` 388, `account.css` 188); 69 layout, 14 control; 81 `className`; 3 styles; 3 files import the library (`Button` only). App-made `Dialog`, `Resizer`, `DockResizer`, palette | `Menu` for the view list, `Avatar` + `Dropdown` for the account, `Modal` for sign-out, `Splitter` for the dock and the sidebar, `IconButton` for the theme switch, `Tag` for the "sees" note | G4 app shell with a collapsing side navigation; G5 command palette; G2 page header | L |
| Home `/` | [dd](assets/web-library-only/shots/20-home-desktop-dark.jpg) [dl](assets/web-library-only/shots/20-home-desktop-light.jpg) [nd](assets/web-library-only/shots/20-home-narrow-dark.jpg) [nl](assets/web-library-only/shots/20-home-narrow-light.jpg) | 3 TSX, 582 lines; `home.css` 245 lines; 49 layout; 15 form elements in 2 raw forms; 55 `className` | `Card`, `Empty`, `List`, `Checkbox` for plan items. "Add your next interview" becomes a DynamicForm: `text` ×4, `dateTime`, `numberInput`, two-column `ui:rows`, `FormActions`. "Add plan item" is one `text` with commit on Enter | G1, G2, G6 grid | M |
| Workspace `/work` | new question: [dd](assets/web-library-only/shots/30-workspace-desktop-dark.jpg) [dl](assets/web-library-only/shots/30-workspace-desktop-light.jpg) [nd](assets/web-library-only/shots/30-workspace-narrow-dark.jpg) [nl](assets/web-library-only/shots/30-workspace-narrow-light.jpg); a question open: [dd](assets/web-library-only/shots/31-workspace-example-open-desktop-dark.jpg) [dl](assets/web-library-only/shots/31-workspace-example-open-desktop-light.jpg) [nd](assets/web-library-only/shots/31-workspace-example-open-narrow-dark.jpg) [nl](assets/web-library-only/shots/31-workspace-example-open-narrow-light.jpg); session draft: [dd](assets/web-library-only/shots/82-workspace-session-draft-desktop-dark.jpg) [dl](assets/web-library-only/shots/82-workspace-session-draft-desktop-light.jpg) | 7 TSX, 1,726 lines; `workspace.css` 980 lines; 99 layout, 27 text, 13 control; 129 `className`; CodeMirror; `diff` | `Steps` for the four stages, `Tabs` for files and for Tests/Output/Problems, `Splitter` for prompt and code, `Dropdown` for Versions, `Checkbox` for "Ask before you code", `DiffReview` for the assistant's change, `Markdown` for the prompt. New question: DynamicForm with `textarea` and `select`, or `Composer` | G7 code editor; G6 grid for the example cards; G3 inline code | L |
| Briefings `/briefings`, `/briefings/explanations`, `/briefings/:pack`, `/briefings/brief/:id` | list and concept: [dd](assets/web-library-only/shots/40-briefings-desktop-dark.jpg) [dl](assets/web-library-only/shots/40-briefings-desktop-light.jpg) [nd](assets/web-library-only/shots/40-briefings-narrow-dark.jpg) [nl](assets/web-library-only/shots/40-briefings-narrow-light.jpg); explanations: [dd](assets/web-library-only/shots/41-briefings-explanations-desktop-dark.jpg) [dl](assets/web-library-only/shots/41-briefings-explanations-desktop-light.jpg); behavioural: [dd](assets/web-library-only/shots/43-briefings-behavioural-desktop-dark.jpg) [dl](assets/web-library-only/shots/43-briefings-behavioural-desktop-light.jpg) [nd](assets/web-library-only/shots/43-briefings-behavioural-narrow-dark.jpg) [nl](assets/web-library-only/shots/43-briefings-behavioural-narrow-light.jpg); system design: [dd](assets/web-library-only/shots/44-briefings-system-design-desktop-dark.jpg) [dl](assets/web-library-only/shots/44-briefings-system-design-desktop-light.jpg) | 10 TSX, 2,942 lines; 2 CSS files, 1,371 lines (`behavioural.css` 1,134); 212 layout, 30 control, 19 form elements in 2 raw forms; 236 `className` | `Splitter` + `OutlineList` for the list, `Segmented` for Concept/System design/Behavioural, `Tabs`, `Collapse`, `Card`, `Tag`, `FileUpload` for the matrix. Behavioural setup becomes a DynamicForm: `text` ×4, `numberInput`, `segmented` for the stage, a collapsible nested object for "Job posting, research and notes" (Templates/Enhancements "Collapsible Closed"), `textarea`, `file`. Questions list: array of `text` | G8 file widget that returns files; G9 array story and tests; G1, G2 | L |
| Documents `/documents`, `/documents/templates`, `/documents/new`, `/documents/:id` | list: [dd](assets/web-library-only/shots/50-documents-desktop-dark.jpg) [dl](assets/web-library-only/shots/50-documents-desktop-light.jpg) [nd](assets/web-library-only/shots/50-documents-narrow-dark.jpg) [nl](assets/web-library-only/shots/50-documents-narrow-light.jpg); templates: [dd](assets/web-library-only/shots/51-documents-templates-desktop-dark.jpg) [dl](assets/web-library-only/shots/51-documents-templates-desktop-light.jpg) [nd](assets/web-library-only/shots/51-documents-templates-narrow-dark.jpg) [nl](assets/web-library-only/shots/51-documents-templates-narrow-light.jpg); new document: [dd](assets/web-library-only/shots/52-documents-new-dialog-desktop-dark.jpg) [dl](assets/web-library-only/shots/52-documents-new-dialog-desktop-light.jpg) [nd](assets/web-library-only/shots/52-documents-new-dialog-narrow-dark.jpg) [nl](assets/web-library-only/shots/52-documents-new-dialog-narrow-light.jpg) | 8 TSX, 3,583 lines; `documents.css` 596 lines; 221 layout, 34 control, 19 form; 278 `className`; `documents-ui.tsx` re-implements `IconButton`, `Segmented`, `Modal`, `Spinner` and a toast; only 2 of 8 files import the library | Documents list: `Table` grouped by application (tree rows, `actions` column, `Empty`, skeleton loading) or `Collapse` + `List`. `Segmented`, `Modal`, `Spin`, `Toast` replace the local copies. New document: DynamicForm in a `Modal` with `radio` cards for template and application, `select` with an option set for experience, `derivedText` for the model, `SplitButton` for Generate. Template editor: DynamicForm with `text`, `textarea`, `file` | G10 card choice for `radio`; G8; G11 table toolbar; G14 toast queue | L |
| Knowledge `/knowledge`, `/knowledge/:slug` | [dd](assets/web-library-only/shots/60-knowledge-desktop-dark.jpg) [dl](assets/web-library-only/shots/60-knowledge-desktop-light.jpg) [nd](assets/web-library-only/shots/60-knowledge-narrow-dark.jpg) [nl](assets/web-library-only/shots/60-knowledge-narrow-light.jpg); after a click: [dd](assets/web-library-only/shots/61-knowledge-article-desktop-dark.jpg) [dl](assets/web-library-only/shots/61-knowledge-article-desktop-light.jpg) | 2 TSX, 1,569 lines (`library.tsx` 1,013, `markdown-content.tsx` 554); 2 CSS files, 1,026 lines; 55 layout, 36 text, 25 control, 20 svg; 64 `className`; `react-markdown`, `rehype-slug`, `panzoom`; no library import | `Input` for search, `Tag` (checkable) for the technology filters, `Menu` for content types and collections, `Card` in a grid for the tiles, `Markdown` with the `./highlight` entry for an article, `Anchor` for its outline, `Breadcrumb` | G15 heading anchors in `Markdown`; G6; G16 image preview for diagrams | M |
| Rehearsal `/rehearsal` | setup: [dd](assets/web-library-only/shots/70-rehearsal-desktop-dark.jpg) [dl](assets/web-library-only/shots/70-rehearsal-desktop-light.jpg) [nd](assets/web-library-only/shots/70-rehearsal-narrow-dark.jpg) [nl](assets/web-library-only/shots/70-rehearsal-narrow-light.jpg); running: [dd](assets/web-library-only/shots/71-rehearsal-running-desktop-dark.jpg) [dl](assets/web-library-only/shots/71-rehearsal-running-desktop-light.jpg) [nd](assets/web-library-only/shots/71-rehearsal-running-narrow-dark.jpg) [nl](assets/web-library-only/shots/71-rehearsal-running-narrow-light.jpg) | 3 TSX, 949 lines; `rehearsal.css` 469 lines; 71 layout; 10 form; 74 `className`; 6 styles; an app-made `Toggle` | Setup is one DynamicForm: `radio` cards for the mode, `multiSelect` or `select` for questions, `switch` ×2 (story "Switch On Left"), submit `Button`. Running: `StatusClock`, `Progress`, `Steps`, `Textarea`. Scorecard: `Statistic`, `Descriptions`, `List`, `Result` | G10; G7 if the running view edits code | M |
| Live session `/live`, `/live/:id` | setup: [dd](assets/web-library-only/shots/80-live-setup-desktop-dark.jpg) [dl](assets/web-library-only/shots/80-live-setup-desktop-light.jpg) [nd](assets/web-library-only/shots/80-live-setup-narrow-dark.jpg) [nl](assets/web-library-only/shots/80-live-setup-narrow-light.jpg); running: [dd](assets/web-library-only/shots/81-live-session-running-desktop-dark.jpg) [dl](assets/web-library-only/shots/81-live-session-running-desktop-light.jpg) [nd](assets/web-library-only/shots/81-live-session-running-narrow-dark.jpg) [nl](assets/web-library-only/shots/81-live-session-running-narrow-light.jpg); ended: [dd](assets/web-library-only/shots/83-live-session-ended-desktop-dark.jpg) [dl](assets/web-library-only/shots/83-live-session-ended-desktop-light.jpg) [nd](assets/web-library-only/shots/83-live-session-ended-narrow-dark.jpg) [nl](assets/web-library-only/shots/83-live-session-ended-narrow-light.jpg) | 36 TSX, 7,172 lines; 11 CSS files, 2,622 lines; 278 layout, 151 text, 76 list, 42 control, 20 form, 6 table; 455 `className`; 15 of 36 files import the library (`Button`, `Textarea`) | Setup is one DynamicForm in sections: `radio` cards (what it is for; how Studio hears and sees), `checkbox` for consent, `switch` per source, `select` for policy and retention, `staticPanel` for the capability notes. Running: `SessionBar`, `Tabs`, `Transcript`, `Empty` tile, `Alert` for banners. Ended: `Descriptions`, `Table` for results and history, `Popconfirm`. `capability-table.tsx` becomes `Table` | G10; G17 `data-testid` on widgets (the claims and 762 test-id selectors depend on it) | XL |
| Native panel `/live/overlay` (the Mac window; a browser is sent away) | [dd](assets/web-library-only/shots/90-native-overlay-desktop-dark.jpg) [dl](assets/web-library-only/shots/90-native-overlay-desktop-light.jpg) [nd](assets/web-library-only/shots/90-native-overlay-narrow-dark.jpg) [nl](assets/web-library-only/shots/90-native-overlay-narrow-light.jpg) | 36 TSX, 10,066 lines; 4 CSS files, 1,971 lines (`panels.css` 1,396); 176 layout; 234 `className`; 46 styles; 25 of 36 files import the library | Finish what the native swap began: start panel, code canvas, answer dock, tests drawer, the two `STYLE` tables in the coach files, the raw `select` in Settings | G7; the open gaps of `native-rework-report.md` section 8 | L, in its own step |

### Presentation (`products/presentation`)

Source: `frontend/index.tsx` (2,639 lines, all seven pages in one file) and `slide-blocks.tsx`;
`presentation.css` 716 lines and 176 rules; 112 layout, 64 text, 107 form elements, 74 buttons and
links; 115 `className`; 5 inline styles; no library import, and the product does not depend on the
library yet.

| Page | Screenshots | What it has now | Library replacement | Gaps | Effort |
|---|---|---|---|---|---|
| `/library` | [dd](assets/web-library-only/shots/100-presentation-library-desktop-dark.jpg) [dl](assets/web-library-only/shots/100-presentation-library-desktop-light.jpg) [nd](assets/web-library-only/shots/100-presentation-library-narrow-dark.jpg) [nl](assets/web-library-only/shots/100-presentation-library-narrow-light.jpg) | Own header, a prompt box with five raw `select` chips, filter and sort buttons, grid or list of decks | Shell from G4; prompt as DynamicForm (`textarea`, `select` ×4 with option sets) or `Composer` with a toolbar; `Segmented` for All/Recent/Favourites and Grid/List; `Table` for the list view with sorting and an `actions` column; `Card` grid; `Empty` | G4, G6, G11 | part of XL |
| `/create` | [dd](assets/web-library-only/shots/101-presentation-create-desktop-dark.jpg) [dl](assets/web-library-only/shots/101-presentation-create-desktop-light.jpg) [nd](assets/web-library-only/shots/101-presentation-create-narrow-dark.jpg) [nl](assets/web-library-only/shots/101-presentation-create-narrow-light.jpg) | A long hand-built form | One DynamicForm; `Wizard` if it stays multi-step | G8 | part of XL |
| `/editor` | [dd](assets/web-library-only/shots/102-presentation-editor-desktop-dark.jpg) [dl](assets/web-library-only/shots/102-presentation-editor-desktop-light.jpg) [nd](assets/web-library-only/shots/102-presentation-editor-narrow-dark.jpg) [nl](assets/web-library-only/shots/102-presentation-editor-narrow-light.jpg) (no deck seeded) | Slide list, canvas, property fields, agent box, export and share | `Splitter`, `OutlineList` for slides, `Toolbar`, DynamicForm for slide properties, `Modal` for share, `Dropdown` for export. The slide canvas is content, not chrome: allow-listed | G18 | part of XL |
| `/themes` | [dd](assets/web-library-only/shots/103-presentation-themes-desktop-dark.jpg) [dl](assets/web-library-only/shots/103-presentation-themes-desktop-light.jpg) [nd](assets/web-library-only/shots/103-presentation-themes-narrow-dark.jpg) [nl](assets/web-library-only/shots/103-presentation-themes-narrow-light.jpg) | Hand-built form (name, description, native file input), theme cards | DynamicForm: `text` ×2, `file`, `color`; `Card` grid | G8, G6 | part of XL |
| `/images` | [dd](assets/web-library-only/shots/104-presentation-images-desktop-dark.jpg) [dl](assets/web-library-only/shots/104-presentation-images-desktop-light.jpg) [nd](assets/web-library-only/shots/104-presentation-images-narrow-dark.jpg) [nl](assets/web-library-only/shots/104-presentation-images-narrow-light.jpg) | Hand-built form and results | DynamicForm; `Image`, `Masonry` | G16 | part of XL |
| `/present` | [dd](assets/web-library-only/shots/105-presentation-present-desktop-dark.jpg) [dl](assets/web-library-only/shots/105-presentation-present-desktop-light.jpg) (no deck seeded) | Full-screen slides | Do not migrate the slide surface; `IconButton` for its controls | none | S |
| `/shared`, and `/share/presentation/:token` | [dd](assets/web-library-only/shots/106-presentation-shared-desktop-dark.jpg) [dl](assets/web-library-only/shots/106-presentation-shared-desktop-light.jpg) | Read-only slides or an error line | `Result` for the error; slides allow-listed | G1 | S |

The whole product is one XL step.

### Pages and states not reached

| Not reached | Why | What to do |
|---|---|---|
| `/native/sign-in` as the Mac app shows it | Without the native host it redirects to `/sign-in`; image 04 is that page | Capture with the host shim, as `native-signin.spec.ts` does |
| Document editor and preview, template editor | Need an experience matrix and a generated document; the spec seeds neither | Seed through the documents API in the spec |
| A behavioural pack with answers; a saved brief | Need generation | Use a scripted scenario |
| Rehearsal scorecard | Needs a finished run | Finish a concept sprint in the spec |
| Live session with tasks, screenshots and results | The spec starts and ends an empty session | Reuse the capture helpers of the suite |
| Workspace stages 2 to 4 and a test run | One click deep only | Extend the spec |
| Presentation editor and present mode with a deck; a valid share link | No deck seeded | Create one through the product's API |
| `global-error.tsx` | Only shows when rendering fails | Read from source |
| Interview brief form and pack review | Drawn only in the native context modal; already library-only | Covered by `scan-states.ts` |

At 480 wide the sidebar collapses to icons and the page does not scroll sideways, but content is
clipped: on Home the two-column form runs under the right edge (image 20, narrow). The Studio has
no narrow layout today. The owner should say what the smallest supported width is before step 3.

## Comparison with the library

### What the three named Storybook pages offer

| Page | What it lists that the web app needs |
|---|---|
| Getting Started / Component Overview | 15 sections. Layout: `Flex`, `Grid`, `Layout`, `Panel`, `Space`, `Splitter`, `Masonry`, `Divider`. Navigation: `Anchor`, `Breadcrumb`, `Dropdown`, `Menu`, `OutlineList`, `Pagination`, `Steps`, `Tabs`, `Wizard`. Data entry and inputs: `Form`, `DynamicForm`, and 25 field parts. Data display: `Card`, `Collapse`, `Descriptions`, `Empty`, `List`, `Table`, `Tag`, `Statistic`, `Timeline`, `Tree`. Feedback: `Alert`, `Drawer`, `Modal`, `Popconfirm`, `Progress`, `Result`, `Skeleton`, `Spin`. Chat shell: `PanelShell`, `SettingsDialog`, `IntegrationList`. Message parts: `Markdown`, `DiffReview` |
| Getting Started / Table Overview | Core (columns, groups, explicit rows, registry cell renderers), interaction (selection, bulk actions, expandable and tree rows, drag, editable cells), data handling (sorting, column filters, pagination, virtualisation, sticky header, controlled state), presentation (sizes, appearance, title, footer, summary, empty, skeleton or spinner loading) |
| dynamic-form / DynamicForm (docs) | JSON Schema plus `uiSchema` plus a required `zodSchema`. AJV validates while typing, Zod at submit. Layout with `ui:rows` (spans per row). Submit buttons are passed as children (`FormActions`). States: Disabled, Read Only, Validation Errors, Api Error, Async Submit. 26 widgets. Templates/Enhancements: collapsible section, label action, static panel. Four showcase forms |

DynamicForm has no `variant` prop. Its variants are: the widget chosen per field and that widget's
options; the row layout; collapsible sections; the disabled and read-only states; and custom
`widgets`, `fields` and `templates` merged over the built-in registries. The library also has a
second form system at the root entry (`Form`, `FormField`, `fieldsFromRows`, `buildZodSchema`),
which the plan does not use.

### Every hand-built form and the DynamicForm that replaces it

| Form | File | Fields today | DynamicForm declaration |
|---|---|---|---|
| Add your next interview | `home/interview-card.tsx` | 6 `input` | `text` ×4, `dateTime`, `numberInput`; `ui:rows` two columns |
| Add plan item | `home/plan-card.tsx` | 1 `input` | `text`, commit on Enter |
| New question | `workspace/new-question.tsx` | `textarea`, `select` | `textarea`, `select` (languages as an option set) |
| New brief | `briefings/new-brief.tsx` | `textarea` | `textarea`; the kind as `segmented` |
| Behavioural setup, questions, matrix | `briefings/behavioural/*.tsx` | 7 `input`, 3 `textarea`, 1 `select` | `text`, `numberInput`, `segmented`, collapsible object, `textarea`, `file`, array of `text` |
| New document | `documents/new-document-dialog.tsx` | 2 `input`, `select`, `textarea` | `radio` cards ×2, `select`, `derivedText`, `textarea` |
| Template editor | `documents/template-library.tsx` | 3 `input`, 2 `textarea` | `text`, `textarea`, `file` |
| Rehearsal setup | `rehearsal/rehearsal-view.tsx` | 2 `select`, 2 toggles | `radio` cards, `select`, `switch` ×2 |
| Rehearsal answer | `rehearsal/live-session.tsx` | `input`, 2 `textarea` | `textarea`; or `Composer` |
| Live setup | `live/setup-*.tsx` | 3 `input`, `select`, 2 segmented | `radio` cards, `checkbox`, `switch`, `select`, `staticPanel` |
| Missing context | `live/shared/missing-context-strip.tsx` | 1 raw `form`, library `Textarea` | `textarea` with inline submit |
| Native Settings language and skill | `overlay/panels/panel-views.tsx` | 2 raw `select` | `select` ×2; one schema with the behaviour flags |
| Interview brief (native, already library fields) | `interview-brief/interview-brief-form.tsx` | 6 `Input`, 7 `Select`, 4 `Textarea`, `FileUpload` | Convert after the web forms prove the pattern, so both surfaces share one schema |
| Presentation prompt, create, themes, images, slide properties | `presentation/src/frontend/index.tsx` | 10 `input`, 13 `select`, 5 `textarea` | `textarea`, `select`, `text`, `color`, `file`, `numberInput` |
| Sign-in | `apps/web/app/sign-in/sign-in-view.tsx` | 2 server-action forms, hidden inputs only | Not a DynamicForm: no fields. Allow-listed |
| Search boxes (palette, Knowledge) | `command-palette.tsx`, `library.tsx` | 1 `input` each | Not forms: `Input` inside the palette part |

### Every list and the Table feature that replaces it

There is one raw `table` in the app. Most lists are `ul`/`li` with classes.

| List | Replacement | Table features used |
|---|---|---|
| Documents by application | `Table` | Tree rows, `actions` column, empty state, skeleton loading |
| Templates | `Card` grid, or `Table` | Sorting, `actions` |
| Presentation library, list view | `Table` | Sorting, pagination, `actions`; grid view stays cards |
| Session results and history (ended) | `Table` | Expandable rows, `tag` and `date` cell types |
| Capability table (live setup) | `Table` | Small size, no pagination |
| Sources and health | `Descriptions` or `Table` | Row states |
| Recent questions, plan items, briefings list, Knowledge side lists | `List`, `OutlineList`, `Menu` | none |
| Transcript, activity | `Transcript`, `Timeline` | none |

### What is missing from the library

Each gap names a second use, because a new part needs one (ADR-0002).

| # | Gap | Kind | Used by | Proposed generic API |
|---|---|---|---|---|
| G1 | Page container | New part, thin | Every page | `Container { maxWidth?: "sm" \| "md" \| "lg" \| "xl" \| "full"; padding?: "none" \| "sm" \| "md" \| "lg"; center?: boolean; as? }`. `center` fills the viewport and centres its child (sign-in, `Result`) |
| G2 | Page header | New part, thin | Home, Documents, Rehearsal, Live, Briefings, settings, Presentation | `PageHeader { title; description?; eyebrow?; actions?: ReactNode; level?: 1 \| 2 }` |
| G3 | Heading levels, inline code, keys | Prop and two sub-parts | Every page | `Typography.Title level={1..4}`; `Typography.Code`; `Typography.Kbd` |
| G4 | App shell with a collapsing side navigation | Extend `Layout`/`Sider` and `Menu` | Interview Studio, Presentation, settings | `Sider { width?; collapsedWidth?; collapsed?; onCollapsedChange?; header?; footer? }`; `Menu { collapsed?: boolean; items[{ key, label, icon, href?, indicator?: { label }, shortcut?: string[] }], groups? }`; `Header { title?; meta?; actions? }`; `Content { scroll?: boolean }`. `PanelShell` stays the chat shell |
| G5 | Command palette | New part over the existing `command` primitive | Interview Studio; the Assistant's slash menu already uses the primitive | `CommandPalette { open; onOpenChange; placeholder?; groups[{ label, items[{ key, label, icon?, shortcut?: string[] }] }]; onSelect(item); emptyText? }` |
| G6 | Responsive grid | Extend `Grid` | Example cards, Knowledge tiles, templates, themes, decks, rehearsal modes | `Grid { columns?: number \| { sm?, md?, lg? }; minItemWidth?: number; gap? }` (auto-fit when `minItemWidth` is set) |
| G7 | Code editor | New entry `./code-editor` | Workspace, native code canvas, rehearsal | `CodeEditor { value; onChange?; language; readOnly?; lineNumbers?; wrap?; extensions? }`, theme from `data-theme`. Its own entry so CodeMirror never loads for other consumers |
| G8 | File widget that returns files | Extend `FileUploadWidget` | Matrix import, template upload, theme import | `ui:options.mode: "files"` gives `File[]` to `onChange`; `accept`, `maxSize`, `maxFiles` as today |
| G9 | Arrays in DynamicForm proven | Story and tests | Questions list, plan items | A "Repeatable Rows" story and tests for add, remove, reorder |
| G10 | Card choice | Option on `Radio` and its widget | Rehearsal modes, document template, application, live "what it is for" and "how Studio hears" | `Radio { appearance?: "list" \| "card" }` with `options[{ value, label, description?, icon?, meta?, disabledReason? }]`; widget option `appearance: "card"` |
| G11 | Table toolbar | Extend `Table` | Documents, Presentation library | `toolbar?: { search?: { value, onChange, placeholder }; actions?: ReactNode; view?: { value, options, onChange } }` |
| G12 | Theme follows the system | Extend `ConfigProvider` | Sign-in, signed-out, not found | `theme.mode: "light" \| "dark" \| "system"` |
| G13 | Client boundary in the build | Build fix | Next.js server components | A `"use client"` banner on the built entries, so a server page can import a part without its own wrapper file |
| G14 | Toast queue; working `message` and `notification` | Fix | Documents, Workspace, Presentation | `useToast()` keeps a queue; `message` and `notification` call it. Today both call `window.alert` |
| G15 | Heading anchors in `Markdown` | Prop | Knowledge, briefings | `headingAnchors?: boolean`, and the outline as data: `onOutline?(items)` for `Anchor` |
| G16 | Image preview | Finish the declared prop | Knowledge diagrams, screenshots, image studio | `Image preview` opens a zoomable viewer (the prop exists and does nothing) |
| G17 | `data-testid` and `data-*` on widgets and `Toolbar` | Passthrough | Every form in the claims inventory | `ui:options["data-testid"]` reaches the control |
| G18 | Scroll area | New part, thin | Lists and side panes outside `Panel` | `ScrollArea { fade?; thin?; maxHeight? }`, sharing `Panel`'s scroll code |

Not gaps: `Segmented`, `Switch`, `Modal`, `Popover`, `Splitter`, `Tabs`, `Steps`, `Empty`, `Alert`,
`Result`, `Avatar`, `Dropdown`, `Collapse`, `Descriptions`, `List`, `Statistic`, `DiffReview`,
`Markdown`, `IntegrationList` and `StatusClock` already exist and replace app-made copies.

## The plan

Order: rules and the tripwire, then the library, then the shell, then pages from smallest to
largest. Each step ends with `pnpm verify` green, the step's stylesheet deleted, and its files
locked at zero. Each step changes more than 1,000 lines, so each one starts with the scope
checkpoint of AGENTS.md rule 1.

| Step | What | Library first | Proof | Size |
|---|---|---|---|---|
| 0 | Write the rule down and lock the baseline. Propose an ADR ("product and shell UI is built only from the UI library") and one line in AGENTS.md. Add a `ui:sync` script like `engine:sync`, which also records the library commit in `vendor/README.md`. Widen the audit (see "The tripwire") with today's numbers as the ceiling | none | The audit fails when any count rises | S |
| 1 | Library wave A: G1, G2, G3, G4, G6, G12, G13, G18. Stories with generic data; a row each in Component Overview | this step | Library `pnpm verify` (80% coverage), a11y Storybook tests, one visual baseline for the shell | L |
| 2 | Shell pages: sign-in, signed-out, settings, not found, the frame. Delete the `auth-*` and `platform-*` rules; move the stray `.studio-*` and `.presentation-*` rules out of `apps/web` | wave A | `web-signin-page.spec.ts` and `smoke-web-signin.spec.ts` unchanged and green; `pages.test.tsx`; the sign-in rows of `claims.ts`; before and after screenshots | S |
| 3 | Studio shell: side navigation, header, palette, account menu, sign-out dialog, dock and sidebar on `Splitter`. Delete `shared/dialog.tsx`, `resizer.tsx`, `dock-resizer.tsx`, `account.css`, most of `studio-base.css` | G5 | `web-shell.spec.ts`, `web-account.spec.ts`, `shortcuts.spec.ts`; add the shell states to `scan-states.ts` | L |
| 4 | Library wave B, then the first DynamicForms: Home and Rehearsal. Prove the pattern on "Add your next interview" (6 fields) before anything larger | G10, G9, G17, G14 | Component tests per form (submit payload, validation, disabled); new rows in `claims.ts` for Home and Rehearsal with their states in `scan-states.ts` | M + M |
| 5 | Briefings | G8 | Existing briefing tests moved to roles; claims rows | L |
| 6 | Documents. Delete `documents-ui.tsx`'s copies | G11 | Existing document tests; claims rows; `Table` states | L |
| 7 | Knowledge | G15, G16 | `markdown-content` and `markdown-highlighting` tests re-pointed at `Markdown` | M |
| 8 | Workspace | G7 | `web-code-canvas.spec.ts`; code panel tests | L |
| 9 | Live session on the web, then the rest of the native overlay | none new | The whole browser suite; `claims-coverage.spec.ts` with `E2E_STRICT=1` for the rows touched; the native hit-region and glass tests | XL + L |
| 10 | Presentation. Add the library as its dependency; split `index.tsx` by page while migrating | none new | Its existing tests; new claims rows; before and after screenshots; the owner signs off the new look | XL |
| 11 | Close out: delete `tokens.css` and what is left of `studio-base.css`; every ceiling in the audit is zero except the allow-list; convert the native interview brief form to the shared schema | none | The audit's count report prints zeros | S |

Rough total: 50 to 60 working days for one worker. Steps 5 to 8 are independent after step 4 and
can run side by side in worktrees, as the native swap did.

### The tests that prove each step

- **Behaviour first.** Before a page changes, every behaviour its tests do not cover gets a test
  against the old page. No existing assertion is loosened; selectors move to roles and names.
- **Control inventory.** `scan-states.ts` today drives sign-in, the Live page and the native
  panel. Home, Workspace, Briefings, Documents, Knowledge, Rehearsal and Presentation are not
  scanned. Each step adds its page's states there and its controls to `claims.ts`, so
  `claims-coverage.spec.ts` fails on a control that appears unlisted after the swap.
- **Component tests.** One per DynamicForm: the schema renders its fields, Zod rejects bad input,
  submit gives the typed payload, an API error shows.
- **Visual check.** Re-run `web-pages.spec.ts` before and after each step and compare by eye. No
  pixel baseline in this repository: the library owns pixel tests for its own parts
  (`pnpm test:visual`), and a second baseline here would break on every library change.

### The tripwire

Extend what exists: `scripts/ui-migration-audit.ts` and its test already run in `pnpm verify` and
already ratchet. No new tool.

| Rule | How |
|---|---|
| Scope | Add `apps/web/app`, `apps/web/src/platform/platform-shell.tsx` and `products/presentation/src/frontend` to the audited files |
| Raw elements | Widen `PRIMITIVES` from six tags to every HTML and SVG element name. Per file, a maximum that may only shrink, with a reason |
| Class strings | Count `className`; same ceiling per file |
| Inline styles | Count `style={` and any `CSSProperties` table; same ceiling |
| Stylesheets | A `.css` import in TSX fails. Each app stylesheet has a line ceiling that may only shrink; a new stylesheet fails |
| Other UI packages | An import of a UI package that is not the library fails unless allow-listed |
| Locked files | A file that reaches zero joins a locked list and must stay at zero (the generalised `context-pane.source.test.ts`) |
| Forms | A raw `form`, `input`, `select` or `textarea`, or a library field used outside a DynamicForm in a file marked as a form, fails |

The documented allow-list, each with its reason in the manifest:

| Allowed | Reason |
|---|---|
| `html` and `body` in `app/layout.tsx` | Next.js requires them |
| `apps/web/app/global-error.tsx`, whole file | It must render when the app's CSS failed to load |
| `<form action>` and hidden inputs in sign-in | A server action with no visible field |
| The slide surface in Presentation (`slide-blocks.tsx`, present mode, shared view) | It draws the user's content with the deck's theme, not app chrome |
| `svg` in `studio/icon.tsx` and `icons.generated.ts` | The library takes icons as `ReactNode` |
| `@omnitech-assistant/react` | A sibling product with its own UI; see below |
| The Swift drag probe's classes (`.pn-pill`, `.pn-single-foot`) | `WindowDrag.swift` reads them |

Biome 2.5 may be able to ban elements by lint rule; that was not checked. The audit test is enough
on its own.

## What should not be migrated, and what should be deleted

| Item | Decision |
|---|---|
| `global-error.tsx` | Keep as it is. It imports no stylesheet by design |
| Slide rendering and present mode | Keep. Content, not chrome |
| The Assistant dock (`@omnitech-assistant/react`) | Not in this plan. It is another repository's UI with its own `oa-*` styles. The library's `./chat` entry has the same parts; rebuilding the dock on them is a decision for that repository |
| Icons | Keep the generated set; pass them as nodes |
| `documents-ui.tsx` `IconButton`, `Segmented`, `Modal`, `Spinner`, toast | Delete; the library has each |
| `shared/dialog.tsx`, `panels/popover.tsx`, `resizer.tsx`, `dock-resizer.tsx`, the rehearsal `Toggle` | Delete; `Modal`, `Popover`, `Splitter`, `Switch` |
| `markdown-content.tsx` (554 lines), `shiki-highlighter.ts` | Delete once `Markdown` has heading anchors |
| `/t/:tenant/settings/integrations` | Decide first. It has no shell and no way back, and is reached only from the account menu. Either it becomes a section of a library `SettingsDialog`, or it is rebuilt in step 2 |
| The web Live page's leftovers | ADR-0033 removed capture and tasks from the web page. Check for dead components before migrating them; delete instead |
| 34 `.studio-*` and 4 `.presentation-*` rules in `apps/web/app/styles.css` | Move to the product or delete; the shell should style nothing of a product |

## Risks

| Risk | What to do |
|---|---|
| The owner expects the native window to be the model for forms, and it has no DynamicForm | Prove DynamicForm on the smallest form in step 4 before committing the larger ones |
| DynamicForm pulls in RJSF, AJV, Zod and Tiptap | Import from `./dynamic-form` and load forms lazily; measure the bundle in step 4 |
| Dirty-state, autosave and drafts (`onDirtyChange`, the canonical draft) rely on controlled fields | Check `formData` and `onChange` cover them on the first form; if not, that is a library gap, not an app workaround |
| App resets out-specify library rules (seen once: a primary button at about 2.4:1 contrast) | Delete each surface's resets in the same step; put what remains in `@layer host` below the library's layer |
| Server components cannot import parts without a client boundary | G13 |
| Tests select by test id (762 uses) and class | G17; move to roles in the behaviour-first pass |
| The native shell's hit regions and drag read class names | Keep the lists in step with every rename; the hit-region and `WindowDragTests` guard it |
| Re-vendoring is manual and unrecorded | The `ui:sync` script of step 0 |
| Library commits are local only (never pushed or published) | Keep that; the tarball is the hand-off |
| Presentation changes its look (its own dark palette becomes the library's tokens) | The owner signs off before step 10 |
| The Studio has no narrow layout | The owner names the smallest supported width before step 3 |
| The plan is large (about 12,000 CSS lines to delete) | Steps are independent after step 4; stop after any step and the audit holds what was won |

## Not done here

- No source was changed and nothing was committed. The brief, the two scripts, the spec, its
  config and the screenshots are the only new files, all under `bionic/briefs/`.
- The build directory `apps/web/.next-e2e-libonly` and `e2e/live-session/.next-e2e-libonly-results`
  were left in place. Both are gitignored build output.
- The ADR and the AGENTS.md line of step 0 are proposals, not written.
- The gap APIs are proposals. Each needs a look at the library source before it is built.
