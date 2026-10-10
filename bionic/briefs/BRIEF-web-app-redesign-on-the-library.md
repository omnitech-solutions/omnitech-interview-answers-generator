---
title: "The web app redesigned on the UI library: gaps verified, the design page by page, and work orders for parallel workers"
slug: web-app-redesign-on-the-library
type: brief
status: draft
created_at: 2026-10-10
updated_at: 2026-10-10
authors: ["desoleary", "claude"]
tags: [ui-library, web, studio, presentation, dynamic-form, boundaries, work-orders, migration]
related_adrs: [ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0033, ADR-0042]
---

# The web app redesigned on the UI library: the executable plan

## Problem

The owner's instruction: redesign the web app using only `@oc-tech/omni-ui-components`; where the
library falls short, add an option to an existing component, and a new component only when clean
code demands one; make every page data-driven with logic in business services and proper
boundaries; and plan it for parallel implementers working in hours, with tests handed to other
workers. The audit `BRIEF-web-app-on-the-ui-library-only.md` estimated 50 to 60 days for one
worker and listed 18 library gaps. This brief checks those gaps against the library's source,
fixes the design, and cuts the work into orders. No source code was changed.

Read with: ADR-0042 and `bionic/research/references/application-boundaries.md` (accepted while
this was written), `bionic/inbox/target-architecture-boundaries-and-vertical-slice.md` (the
boundary rule and configuration versus code), the audit brief and its `assets/web-library-only/` (screenshots,
`inventory.md`), and the library's `README.md` section "How things are built here".

## 1. What changed from the audit, in short

| Finding | Detail |
|---|---|
| Library read at | `omni-ui-components` commit `dcdb018` (one commit after the audit's `f208942`), clean tree |
| The 18 gaps | 3 need no library change, 13 are options on existing components, 1 is a build setting, 1 is a true new component (`CodeEditor`) |
| Shells | The owner is right that the parts exist (`Layout`, `Header`, `Sider`, `Content`, `Footer`, `Menu`; story `omni-ui-components/Layout` "Default"). They are bare wrappers today: `Layout.tsx` is 22 lines of five styled tags, and `Menu` has no links, no collapse and no current-page state. The shell is built by adding options to them. No `AppShell` component is added |
| Extra library needs found | Four that the audit missed, all options: section headings and a test hook in the DynamicForm templates, a focus handle on `DynamicForm`, and the widget author's exports (library brief `BRIEF-dynamic-form-widget-coverage.md` findings C3 and C4) |
| Navigation | Already data: `studio/config/views.tsx` and `config/commands.ts` drive the sidebar, the palette and the shortcuts. The redesign maps that list onto `Menu` items; it does not invent a new config |
| Form schemas | Both repositories are on Zod 4, so a form's JSON Schema is read from its contract and the same contract is the `zodSchema`. The helper already exists: `contractFormSchema(contract, fields?)` in `studio/shared/contract-form.ts` (added by the boundary workers today). No field is declared twice |
| Work already under way | Seen in the working tree while this was written, by other workers: ADR-0042 and its tripwire (`scripts/application-boundaries.ts` with the debt ledger `application-boundaries-debt.ts`), the live-session backend split into `contracts/`, `domain/`, `services/`, `repositories/`, `handlers/`, `document-form-config.ts`, and two native forms (`behaviour-flags-form.ts`, `interview-context-form.ts`). The orders below name these as theirs and do not repeat them |
| Work orders | 107, in 6 waves. 58 can be implemented before 2026-10-16; 49 wait |
| Elapsed time | About 1 working day for waves 0 to 2 with 15 to 20 workers, and about 1.5 days for waves 3 to 5 after the 16th. The limit is three serial points (section 9), not the amount of work |

## 2. The gaps, verified against the library's source

Verdicts: **Handled** (use what exists), **Option** (extend an existing component; the default
keeps today's output), **Build** (packaging), **New** (a new component).

| # | Audit's gap | Verdict | What the source shows | What to use or add |
|---|---|---|---|---|
| G1 | Page container | Option | `Content` is `<main class="min-h-0 flex-1 px-6 py-4">` with no props (`Layout/Layout.tsx`) | `Content { maxWidth, padding, center, scroll }` (LIB-01) |
| G2 | Page header | Option | `Header` is `<header class="border-b px-6 py-4">`. `Panel` already has the shape wanted: `title`, `subtitle`, `meta`, `actions` (`Panel.types.ts`) | `Header { title, description, eyebrow, meta, actions, level }`, same names as `Panel` (LIB-01) |
| G3 | Heading levels, inline code, keys | Option | `Typography.Title` is always `h2`; `Text` has `type` and `size` only | `Title level`, `Text code`, `Text keyboard` (LIB-03) |
| G4 | App shell with a collapsing side navigation | Option | `Sider` is `<aside class="border-r px-4 py-4">`; `Menu` items are `{ key, label, icon, children, onClick }`, always a bordered card, buttons only. `PanelShell` is the chat shell (assistant beside a host) and is not the app frame | `Sider { collapsed, width, header, footer, ... }`, `Layout { direction, fill }` (LIB-01); `Menu { collapsed, appearance, onSelect }` with link, indicator, shortcut and group items (LIB-02) |
| G5 | Command palette | Option | `CommandPopover` is the listbox (rows with icon and description, `label`, `title`, `hint`, `onSelect`), built to sit against a composer; the shadcn `command` primitive is internal | `CommandPopover { search, placement: "inline" }` and `CommandItem { group, shortcut }`; the palette is `Modal` + `CommandPopover` (LIB-05) |
| G6 | Responsive grid | Option | `Row` is flex-wrap with `gutter`; `Col` is a width of n/24 | `Row { columns, minItemWidth }` (LIB-04) |
| G7 | Code editor | **New** | Nothing in the library edits code; CodeMirror is a heavy dependency that must not load for other consumers, so it cannot be an option of `Textarea`. Three users: Workspace, the native code canvas, the rehearsal answer | `CodeEditor` in its own entry `./code-editor` (LIB-15) |
| G8 | File widget that returns files | Option | `FileUploadWidget` submits names only, and draws a notice unless `ui:options.mode` is `"name"` | `mode: "file" \| "data-url" \| "name"` (LIB-07); the library brief asks for the same |
| G9 | Arrays in DynamicForm proven | Handled, by not using arrays | The registries hold no array template; arrays fall to `@rjsf/shadcn`, and the library brief defers an array template to an ADR | The two lists (plan items, behavioural questions) are a `List` plus a one-field form (`text`, `commitOnEnter`, which `TextWidget` already has). No library work |
| G10 | Card choice | Option | `RadioOption` is `{ value, label, description, disabled }`; `RadioPrimitive` has `orientation` only | `Radio { appearance: "list" \| "card" }`, `RadioOption { icon, meta, disabledReason }`, widget option `appearance` (LIB-06) |
| G11 | Table toolbar | **Handled** | `TableProps.title` is a render slot above the table (`Table/components/Title.tsx`), and `Toolbar variant="bar"` is a full-width row with `leading` and `trailing` | `title={() => <Toolbar variant="bar" leading={<Input .../>} trailing={<Segmented .../>} />}`. No library work |
| G12 | Theme follows the system | Option | `ThemeMode` is `"light" \| "dark"`; `ConfigProvider` writes `data-theme` on the root | `ThemeMode` gains `"system"` (LIB-13). Only sign-in needs it: inside a tenant, `PlatformShell` already resolves the system theme |
| G13 | Client boundary in the build | Build | `vite.config.ts` sets no banner; only three internal files carry `"use client"`, and bundling drops it | A `"use client"` banner on the built entries (LIB-14). Until then a view file carries its own directive |
| G14 | Toast queue; `message` and `notification` | **Handled** | `Toast` and `useToast()` exist (`notify`, `dismiss`, action, placement, timer, Escape); the app shows one message at a time. `message` and `notification` are exported and call `window.alert` | Use `Toast` + `useToast`. The app's audit bans importing `message` and `notification`. No library work |
| G15 | Heading anchors in `Markdown` | Option | `MarkdownProps` has `components` overrides but no ids on headings and no outline | `headingAnchors`, `onOutline` (LIB-10) |
| G16 | Image preview | Option | `ImageProps.preview` is declared and ignored (`Image.tsx`, 13 lines) | Make `preview` work (LIB-11) |
| G17 | `data-testid` on widgets | Option | `Toolbar` and `Table` take a test id; no widget does. One template draws every field | `FieldTemplate` puts `data-field` and the optional `ui:options["data-testid"]` on the field's root (LIB-08) |
| G18 | Scroll area | Option, folded into G1 | `Panel` is the scroll container (`scroll: { fade, thinScrollbar }`) but needs a `title` | `Content scroll` and `Sider scroll` (LIB-01); a titled region uses `Panel` |

Totals: Handled 3 (G9, G11, G14). Option 13 (G1 to G6, G8, G10, G12, G15 to G18). Build 1 (G13).
New 1 (G7).

Not in the audit, needed by the design, all options: DynamicForm section headings for nested
objects (LIB-08), a `DynamicForm` handle with `focusField` for "preview selection focuses the
field" in the target architecture (LIB-09), and the widget author's exports (LIB-09).

## 3. Library work orders

Repository: `~/dev/omnitech-solutions/omni-ui-components`. Every order follows the library's
README checklist. Rules that keep orders apart:

- An implementer owns the component's folder under `packages/core/src/` (source, types,
  factories, stories with a `play` per interaction). A tester owns
  `packages/core/test/<Name>/` or `src/dynamic-form/test/`. Neither edits the other's files.
- No order except LIB-12 and LIB-16 touches `CHANGELOG.md`, `bionic/journal/`,
  `ComponentOverview.stories.tsx`, `theme-contract.md` or `src/index.ts`. Each handback carries
  its changelog line and any token rows; the integrator writes them.
- Every new prop is optional and its absence renders exactly today's markup and classes. A tester
  proves that with one "no new props" snapshot per component. This is what makes a re-vendor safe
  for the native window.
- Colours and sizes are `--oui-*` tokens, both themes. Strings go through `labels`. Icons are
  nodes.

| Order | Component and change | Type signature | Behaviour | Stories | Files |
|---|---|---|---|---|---|
| LIB-01 | `Layout`, `Header`, `Content`, `Sider`: options | `LayoutProps { direction?: "column" \| "row"; fill?: boolean }` · `HeaderProps { title?: ReactNode; description?: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; actions?: ReactNode; level?: 1 \| 2 \| 3; bordered?: boolean; padding?: "none" \| "sm" \| "md" }` · `ContentProps { maxWidth?: "sm" \| "md" \| "lg" \| "xl" \| "full"; padding?: "none" \| "sm" \| "md" \| "lg"; center?: boolean; scroll?: boolean; as?: "main" \| "div" \| "section" }` · `SiderProps { width?: number; collapsedWidth?: number; collapsible?: boolean; collapsed?: boolean; defaultCollapsed?: boolean; onCollapsedChange?(collapsed: boolean): void; header?: ReactNode \| ((s: { collapsed: boolean }) => ReactNode); footer?: same; scroll?: boolean; label?: string; side?: "start" \| "end"; collapseIcon?: ReactNode; expandIcon?: ReactNode; labels?: Partial<{ collapse: string; expand: string }> }` | `fill` makes the layout the height of the viewport and stops the page scrolling; `direction="row"` lays a `Sider` beside the rest. `Header` with `title` draws eyebrow, a heading of `level`, description, then `meta` and `actions` at the end; children still render. `Content center` centres its child in the space; `scroll` scrolls inside with the thin scrollbar of `Panel`. `Sider` is controlled and uncontrolled through `use-controllable-state`; collapsed, it is `collapsedWidth` wide and sets `data-collapsed`; the collapse control is drawn only when `collapsible` | `App Shell` (full page: Sider with header, Menu, footer; Header with title and actions; scrolling Content), `Collapsed`, `Centred Content`, `Page Header`; move types to `Layout.types.ts`, add `Layout.factories.tsx` | `src/Layout/*` |
| LIB-02 | `Menu`: options | `MenuItem { key; label; icon?; children?; onClick?; href?: string; target?: string; disabled?: boolean; disabledReason?: string; indicator?: { label: string; tone?: "accent" \| "success" \| "warning" \| "danger" }; shortcut?: string[]; type?: "item" \| "group" \| "divider" }` · `MenuProps<T extends MenuItem = MenuItem> { items: T[]; selectedKeys?: Key[]; onSelect?(item: T): void; collapsed?: boolean; appearance?: "card" \| "plain"; size?: "default" \| "compact"; label?: string }` | An item with `href` is an anchor; `onSelect` fires with the full item and may `preventDefault` through a returned `false`. The selected item carries `aria-current="page"`. `indicator` is a dot with an accessible name. `shortcut` draws keys at the end. A `group` draws its label and its children flat. `collapsed` shows icons only, each with a `Tooltip` of its label. `appearance="plain"` drops the card border and fill (default `card` is today's look) | `Navigation` (plain, links, indicator, shortcuts, groups), `Collapsed`; `Menu.types.ts`, `Menu.factories.tsx` | `src/Menu/*` |
| LIB-03 | `Typography`: options | `Title { level?: 1 \| 2 \| 3 \| 4 }` · `Text { code?: boolean; keyboard?: boolean; strong?: boolean }` | `level` chooses the element (`h1` to `h4`) and the size step; absent, it is today's `h2` at today's size. `code` renders `<code>` in the mono font on the field surface; `keyboard` renders `<kbd>` | `Heading Levels`, `Code And Keys` | `src/Typography/*` |
| LIB-04 | `Row`: options | `RowProps { gutter?: number \| [number, number]; columns?: number \| { base?: number; sm?: number; md?: number; lg?: number }; minItemWidth?: number }` | With `columns` or `minItemWidth` the row is a CSS grid: fixed tracks, or `repeat(auto-fill, minmax(minItemWidth, 1fr))`. Breakpoints are container queries, so a grid inside a narrow panel folds. Children need no `Col`. Without either prop it is today's flex row | `Card Grid`, `Responsive Columns` | `src/Grid/*` |
| LIB-05 | `CommandPopover`: options | `CommandItem { group?: string; shortcut?: string[] }` · `CommandPopoverProps { search?: { label: string; value?: string; defaultValue?: string; onChange?(query: string): void; placeholder?: string; icon?: ReactNode }; filter?: false \| ((item: T, query: string) => boolean); placement?: "above" \| "below" \| "inline" }` | With `search` the component draws its own input, owns Arrow, Enter and Escape on it, filters by label unless `filter={false}`, and keeps `aria-activedescendant` on the input. Items with `group` are drawn under group headings in first-seen order. `inline` drops the absolute positioning so it fills a `ModalContent` | `Command Palette` (inside `Modal`, groups, shortcuts, empty text) with a `play` that types, arrows and selects | `src/CommandPopover/*` |
| LIB-06 | `Radio` and `RadioWidget`: option | `RadioPrimitiveProps { appearance?: "list" \| "card" }` · `RadioOption { icon?: ReactNode; meta?: ReactNode; disabledReason?: string }` · widget `ui:options { appearance?: "card"; optionMeta?: Record<string, string>; optionDisabledReasons?: Record<string, string> }` | `card` draws each option as a bordered tile (icon, label, description, meta at the end) that is the radio; the chosen tile takes the interactive border. A `disabledReason` disables the option and shows the reason as its description and tooltip. Keyboard and roles are the radio group's, unchanged | `Cards`, `Cards With Reason`; widget story `Card Choice` | `src/Radio/*`, `src/dynamic-form/widgets/RadioWidget/*` |
| LIB-07 | `FileUploadWidget`: option | `ui:options { mode?: "file" \| "data-url" \| "name"; accept?; maxSize?; maxFiles? }` | `file` gives `File` (or `File[]` for an array schema) to `onChange`; `data-url` gives the string. A refused file (type, size, count) is the field's error. The on-screen notice is drawn only when `mode` is absent | `File Values`, `Refused File` | `src/dynamic-form/widgets/FileUploadWidget/*` |
| LIB-08 | DynamicForm templates: options | `ui:options { "data-testid"?: string; section?: "plain" \| "card" \| "none" }` | `FieldTemplate`: the field root carries `data-slot="form-field"`, `data-field="<property name>"` and the optional `data-testid`. `ObjectFieldTemplate`: a nested object draws its `title` and `description` as `fieldset` and `legend` (`plain`), inside a `Card` (`card`), or not at all (`none`); the root object draws none; `collapsible` keeps working | `Sections` in `TemplateEnhancements.stories.tsx` | `src/dynamic-form/templates/FieldTemplate.tsx`, `ObjectFieldTemplate.tsx`, `TemplateEnhancements.*` |
| LIB-09 | `DynamicForm`: handle and exports | `DynamicFormHandle { focusField(path: string): boolean; submit(): void }` through `ref`; `./dynamic-form` also exports `OmniRjsfFormContext`, `OmniSelectOption`, `OmniRjsfAction`, `buildFormContext`, `useStableRjsfCallbacks` | `focusField("contact.email")` focuses the control of that property and returns whether it was found (it reads `data-field` from LIB-08, so it never depends on a class). `submit` runs the same Zod-gated submit as the button | `Focus A Field` | `src/dynamic-form/DynamicForm/DynamicForm.tsx`, `src/dynamic-form/index.ts`, `DynamicForm.stories.tsx` |
| LIB-10 | `Markdown`: options | `MarkdownProps { headingAnchors?: boolean; onOutline?(items: MarkdownOutlineItem[]): void }` · `MarkdownOutlineItem { id: string; text: string; level: 1 \| 2 \| 3 \| 4 \| 5 \| 6 }` | With `headingAnchors` each heading gets a stable slug id (duplicates numbered). `onOutline` fires when the list of headings changes, in document order, for an `Anchor` | `Article With Outline` (Markdown beside `Anchor`) | `src/Markdown/*` |
| LIB-11 | `Image`: finish `preview` | `ImageProps { preview?: boolean \| { zoom?: boolean; label?: string } }` | With `preview` the image is a button that opens a `Modal` showing it at full size; `zoom` adds wheel and pinch zoom with drag to pan and a reset on double click; Escape closes and focus returns | `Preview`, `Zoomable Preview` | `src/Image/*` |
| LIB-12 | Integration 1 | none | Adds the Component Overview rows, the changelog entries, the journal entry and token rows from the handbacks of LIB-01 to LIB-11; runs `pnpm verify`, `pnpm test:storybook`, `pnpm test:visual` (the 10 Native App captures must not change) | none | `CHANGELOG.md`, `bionic/journal/`, `.storybook/getting-started/ComponentOverview.stories.tsx`, `theme-contract.md` |
| LIB-13 | `ConfigProvider`: option | `ThemeMode = "light" \| "dark" \| "system"` | `system` follows `prefers-color-scheme` and updates on change | `System Theme` | `src/ConfigProvider/*` |
| LIB-14 | Build: client boundary | none | `rollupOptions.output.banner` puts `"use client";` first in the `index`, `dynamic-form/index`, `native`, `chat` (and later `code-editor`) builds, not in `highlight`. A fixture proves a Next.js server component can import `Button` | none | `packages/core/vite.config.ts`, `packages/core/fixtures/` |
| LIB-15 | `CodeEditor`: new component, new entry | `CodeEditorProps { value: string; onChange?(next: string): void; language: "typescript" \| "tsx" \| "javascript" \| "php" \| "ruby" \| "json" \| "markdown" \| "text"; label: string; readOnly?: boolean; lineNumbers?: boolean; wrap?: boolean; height?: number \| string; diagnostics?: CodeDiagnostic[]; onCursorChange?(at: { line: number; column: number }): void }` · `CodeDiagnostic { line: number; column: number; endLine?: number; endColumn?: number; message: string; severity: "error" \| "warning" \| "info" }` | CodeMirror behind the prop surface; theme from the nearest `data-theme`; grammars loaded on first use of a language; `label` is the accessible name. Exported only from `@oc-tech/omni-ui-components/code-editor` | `Default`, `Read Only`, `Diagnostics`, `Languages` | `src/CodeEditor/*`, `src/entries/code-editor.ts`, `package.json` `exports`, `vite.config.ts` (after LIB-14) |
| LIB-16 | Integration 2 | none | As LIB-12 for LIB-13 to LIB-15, plus a row in `bundle-weight.md` for the new entry | none | as LIB-12, `bionic/research/references/bundle-weight.md` |

Library test orders (each tester writes behaviour, keyboard, names and roles, controlled and
uncontrolled, and the "no new props" snapshot):

| Order | Covers | Files |
|---|---|---|
| LT-01 | LIB-01, LIB-02 | `test/Layout/*`, `test/Menu/*` |
| LT-02 | LIB-03, LIB-04, LIB-11 | `test/Typography/*`, `test/Grid/*`, `test/Image/*` |
| LT-03 | LIB-05 | `test/CommandPopover/*` |
| LT-04 | LIB-06, LIB-07 | `test/Radio/*`, `src/dynamic-form/test/DynamicForm.radio.test.tsx`, `DynamicForm.file-upload.test.tsx` |
| LT-05 | LIB-08, LIB-09 | `src/dynamic-form/test/DynamicForm.sections.test.tsx`, `DynamicForm.handle.test.tsx` |
| LT-06 | LIB-10 | `test/Markdown/Markdown.outline.test.tsx` |
| LT-07 | LIB-13, LIB-14, LIB-15 | `test/ConfigProvider/*`, `test/CodeEditor/*`, the Next.js fixture check |

Testers start from the signatures in this table at the same time as the implementers and finish
against the implementation.

## 4. The design: shared parts first

### 4.1 One pattern for every page

```
<page>-config.ts     pure data: form config, table columns, action descriptors, empty states
use-<page>.ts        the one controller: server state through the typed client, draft state,
                     the action implementations, the context that availability rules read
<page>-view.tsx      composition of library parts only; no fetch, no rule, no className, no style
```

Types, one small file per product (`studio/config/page-config.ts` in Interview,
`frontend/config/page-config.ts` in Presentation; about 40 lines each, type-only, so a shared
package is not justified under ADR-0002):

```ts
export type ActionDescriptor<TContext = void> = {
  id: string;
  label: string;
  icon?: IconName;
  tone?: "primary" | "neutral" | "danger";
  shortcut?: string;
  available?(context: TContext): boolean;            // false: not drawn
  disabledReason?(context: TContext): string | null; // a string: drawn disabled, with the reason
  confirm?: { title: string; description?: string; confirmLabel: string };
};

export type FormConfig<TContract extends z.ZodType> = {
  contract: TContract;      // from @omnitech/interview-contracts; also DynamicForm's zodSchema
  schema: FormSchema;       // contractFormSchema(contract, fields), never written by hand
  uiSchema: FormUiSchema;   // widgets, ui:rows, labels, option sets: the only hand-written part
  defaults: z.input<TContract>;
};
// FormSchema, FormUiSchema and contractFormSchema come from studio/shared/contract-form.ts.

export type TableConfig<TRow> = {
  rowKey: keyof TRow & string;
  columns: TableColumn<TRow>[];
  rowActions: ActionDescriptor<TRow>[];
  toolbar: ActionDescriptor<{ selected: TRow[] }>[];
  empty: { title: string; description: string; actionId?: string };
};
```

Configuration carries labels, order, widgets, columns, availability and presentation. The
controller carries behaviour: what an action does, concurrency, cancellation. An action
descriptor names an `id`; the controller maps `id` to a function. There is no interpreter of
steps (target architecture, section 4).

### 4.2 Shared compositions

| Part | Composition | Data |
|---|---|---|
| App shell (Interview Studio and Presentation) | `Layout direction="row" fill` > `Sider collapsible collapsed header={brand} footer={account + theme IconButton}` > `Menu appearance="plain" collapsed items selectedKeys onSelect` ; then `Layout` > `Header title meta actions` + `Content scroll`. The Assistant dock sits in a `Splitter resizable` beside `Content` | `studio/config/navigation.ts`: `navigationItems(views, products, recent, indicators): MenuItem[]` built from the existing `views` list (label, icon, `goKey` as `shortcut`, `indicator`), a `group` for Products with `href` items, a `group` for Recent questions. Presentation has its own five-item list |
| Command palette | `Modal` > `ModalContent` > `CommandPopover search placement="inline" items onSelect` | `paletteItems(commands, lists)`: the existing `commands` list (`group`, `label`, `icon`, `shortcut`, `when`) mapped to `CommandItem` |
| Page header | `Header title description actions` inside the page, `level={1}` | The view's label from `views`; actions from the page's `ActionDescriptor` list |
| Page container | `Content maxWidth padding scroll` | none |
| List of records | `Table columns dataSource title={toolbar} locale.emptyText={<Empty/>} loading="skeleton"` with an `actions` column | `TableConfig<TRow>` |
| Card grid | `Row minItemWidth={260} gutter={16}` of `Card` | an array from the controller |
| Form | `DynamicForm schema uiSchema zodSchema formData onChange onSubmit` with `Button type="submit"` children; in a `Modal` for a dialog | `FormConfig<Contract>` |
| Empty state | `Empty variant="tile" icon title description action` | `TableConfig.empty` or the page config |
| Error state | `Alert` with a Retry `Button` for a failed load inside a page; `Result status="error"` for a whole page | controller `status` |
| Toast | one `Toast {...toast.props}` at the shell, `useToast()` passed down through the studio context | `toast.notify({ text, actionLabel })` |
| Confirm | `Popconfirm` for a row action, `Modal` for a blocking choice | `ActionDescriptor.confirm` |

### 4.3 Decisions the plan makes

- Smallest supported width: 480. Under 768 the `Sider` starts collapsed (icons only), as today.
  The owner may change the number before SH-03; nothing else depends on it.
- `/t/:tenant/settings/integrations` is rebuilt as a page (`Header` with a back link,
  `IntegrationList`). Moving it into a `SettingsDialog` is a later choice.
- Not migrated, and allow-listed with a reason: `global-error.tsx`; `html` and `body`; the
  server-action `<form>` of sign-in; the slide surface of Presentation; the generated icons; the
  Assistant dock (`@omnitech-assistant/react`); the Swift drag probe's classes.

## 5. The design, page by page

Counts are from `assets/web-library-only/inventory.md` for the page's source folder
(layout / text / form / control elements, `className`, stylesheet lines). Screenshot numbers are
the files `assets/web-library-only/shots/NN-*.jpg`.

### Shell pages (`apps/web`): 16 TSX files, 21 layout, 19 text, 6 form, 4 control, 26 `className`, 5 styles, `styles.css` 645 lines

| # | Page (shots) | Composition | Data | Controller | Deleted |
|---|---|---|---|---|---|
| 1 | `/sign-in`, expired, `?next=` (01, 02) | `Content center maxWidth="sm"` > `Card` > `Typography.Title level={1}`, `Alert` (expired, signed out), one server-action `form` per provider holding a `Button type="submit"` with the provider icon, `Divider` with label, "last used" as `Tag` | `providers: { id, label, icon, disabledReason? }[]` from `auth-settings.ts`; notice text keyed by `reason` | none: a server component with a server action; `last-used.tsx` stays the one client part | 37 `auth-*` rules; raw buttons and the hand-made divider |
| 2 | `/signed-out` (03) | `Content center` > `Result status="success" title subTitle extra={<Button asChild>link</Button>}` | static copy | none | `auth-card`, the styled link |
| 3 | `/native/sign-in` (04) | no markup of its own (43 lines); follows page 1 | none | none | nothing |
| 4 | `/share/presentation/:token` (05) | Presentation's shared view: page 22 | page 22 | page 22 | page 22 |
| 5 | `/t/:tenant/settings/integrations` (10) | `Content maxWidth="md"` > `Header title="Integrations" actions={back link}` > `IntegrationList items connectAction` | `IntegrationItem[]` mapped on the server from connected accounts | none: server page plus a client view file | `platform-*` card rules, two hand-made cards |
| 6 | Not found, unknown product (06, 11) | `Content center` > `Result status="warning"` with a home link | static | none | Next.js default page replaced by `app/not-found.tsx` |
| 7 | `global-error.tsx` | not migrated (it must render when the stylesheet failed) | none | none | nothing; allow-listed |
| frame | `PlatformShell` | a fragment: each product brings its own `Layout` | theme, locale and AI profile effects stay | stays as it is | the `platform-frame-*` `div` and `main`, 2 class uses |

### Interview Studio shell: 15 TSX files, 69 layout, 14 control, 81 `className`, 3 styles, 4 stylesheets of 1,296 lines

| Part (shots 21, 22, 23) | Composition | Data | Controller | Deleted |
|---|---|---|---|---|
| Frame, sidebar, header | section 4.2 "App shell". Header: `title={view.label}`, `meta={<Tag>sees: ...</Tag>}`, `actions={<Button pressed>Assistant</Button>}`, the views' portal slot stays | `navigation.ts` | `use-studio-shell.ts`: palette open, rail and pinned state, focus mode, dock width, the `StudioActions`; extracted from `studio.tsx` (506 lines) | `sidebar.tsx` markup, `resizer.tsx`, `dock-resizer.tsx`, the frame rules of `studio-base.css` |
| Command palette | section 4.2 | `paletteItems()` | part of `use-studio-shell.ts` | `command-palette.tsx` list markup |
| Account menu, sign-out dialog, welcome banner | `Dropdown` with an `Avatar` trigger; `Modal` with `ModalFooter` buttons; `Alert` with a close action | `accountMenuItems(member, tenant): ActionDescriptor[]` in `account-model.ts` | `use-account.ts` wrapping `sign-out.ts` | `account.css` (188 lines), `shared/dialog.tsx` once its last user is gone |

### Interview Studio pages

| # | Page (shots) | Composition | Data | Controller | Deleted |
|---|---|---|---|---|---|
| 8 | Home (20) | `Content maxWidth="xl"` > `Header level={1}` > `Row columns={{ base: 1, lg: 2 }}` of `Card`: next interview (`Descriptions`, or `Empty` with the action "Add your next interview" opening the form), plan (`List` of `Checkbox` rows with an `ActionMenu`, and a one-field form to add), recent questions (`List` with `Tag` status) | `interviewForm: FormConfig<typeof interviewPlanInputSchema>` with `ui:rows` two columns, `dateTime` for `scheduledAt`, `numberInput` for `durationMinutes`, `tagInput` for `topics`; `planItemForm: FormConfig<typeof planItemInputSchema>`; `planItemActions` | `use-home.ts` over `use-plan.ts` (already on `createPlanClient`) and the studio lists | `home.css` 245 lines; 49 layout, 15 form elements, 2 raw forms, 55 `className` |
| 9 | Workspace (30, 31, 82) | `Splitter resizable` of two `Panel`s. Left: `Steps` for the four stages, then the stage pane (`Markdown`, `Collapse`, `Checkbox` "Ask before you code"). Right: `Tabs` of files over `CodeEditor`, then `Tabs` Tests / Output / Problems. Header actions: Run tests `SplitButton`, Versions `Dropdown`. Assistant change: `DiffReview`. New question: `Row minItemWidth` of example `Card`s and a form | `stages` (exists in `stages.ts`) as `Steps` items; `newQuestionForm: FormConfig` (`textarea`, `select` with the language option set); `workspaceActions: ActionDescriptor<{ stage, dirty, running }>[]` | `use-workspace.ts` over the existing `use-canonical-draft.ts`; the `studioFetch` calls at `workspace-view.tsx:151` and `use-canonical-draft.ts:80,253` move behind a typed client | `workspace.css` 980 lines; 99 layout, 27 text, 13 control, 129 `className`; direct CodeMirror imports |
| 10 | Briefings list and concept (40, 41, 44) | `Splitter` > `Panel title="Briefings"` holding `Segmented` (Concept / System design / Behavioural) and `OutlineList`; `Panel` holding the brief: `Tabs`, `Collapse`, `Markdown`, `Tag`. New brief: form | `newBriefForm: FormConfig<typeof briefRequestSchema>` (`segmented` kind, `textarea`); `briefActions` | `use-briefings.ts` over `createBriefsClient` (in use today) | `briefings.css` 235 lines and this folder's share of 212 layout, 236 `className` |
| 11 | Behavioural pack (43) | `Tabs` Setup / Questions / Answers. Setup: one form with a collapsible section. Questions: `List` plus a one-field add form. Matrix: `Table` (small) with a file form. Answers: `Collapse` of `CueCard`-style `Card`s with `Tag` evidence | `behaviouralSetupForm: FormConfig<typeof briefingContextSchema>` (`text` ×4, `numberInput`, `segmented` stage, nested object with `collapsible`, `textarea`, `file` in `mode: "file"`); `matrixColumns: TableConfig`; `packActions` | `use-behavioural-pack.ts` over `createBriefingClient` | `behavioural.css` 1,134 lines; 19 form elements, 2 raw forms |
| 12 | Documents list, templates, new document (50, 51, 52) | `Header` with `Segmented` Documents / Templates and the New document `Button`. List: `Table` with tree rows by application, `actions` column, `Empty`. Templates: `Row minItemWidth` of `Card`s with `ActionMenu`. New document: `Modal` > form, Generate as `SplitButton`. Template editor: `Drawer` > form | `documentColumns: TableConfig<DocumentRow>`; `newDocumentForm: FormConfig<typeof documentCreateSchema>` (`radio` `appearance: "card"` for template and application, `select` experience, `derivedText` model, `textarea`); `templateForm: FormConfig<typeof documentTemplateCreateSchema>` (`text`, `textarea`, `file`); `documentActions` | `use-documents.ts` over `documents-client.ts` (keeps `documents-model.ts` as the pure part) | `documents-ui.tsx` (its `IconButton`, `Segmented`, `Modal`, `Spinner`, `PageHeader`, toast), `documents.css` 595 lines; 221 layout, 34 control, 19 form, 278 `className` |
| 13 | Document editor and preview | The target architecture's slice, unchanged: `Splitter` > `Panel` (form from the template's fields) + `Panel` (existing `DocumentPreview`); preview selection calls `form.focusField(key)` | `document-form-config.ts`: template fields to `schema` + `uiSchema`, grouped to flat values, lossless | `use-document-editor.ts` (draft, revision, mutation, 250 ms preview with abort) | the hand-kept field layout and inputs of `document-editor.tsx` (1,374 lines) |
| 14 | Knowledge browse (60) | `Layout direction="row"` > `Sider` with `Menu appearance="plain"` (content types, collections) > `Content scroll`: `Input` search, checkable `Tag` filters, `Row minItemWidth` of `Card`s, `Empty` | `knowledgeFilters` (types, collections, technologies) from the library index response; `articleCard(row)` | `use-knowledge.ts`: the fetch at `library.tsx:48`, the filter and search state | `library.css` 852 lines; 55 layout, 25 control, 64 `className` |
| 15 | Knowledge article (61) | `Breadcrumb`, `Markdown headingAnchors highlight onOutline`, `Anchor` beside it, diagrams as `Image preview={{ zoom: true }}` | the outline from `onOutline` | part of `use-knowledge.ts` | `markdown-content.tsx` (554 lines), `shiki-highlighter.ts`, `knowledge.css` 172 lines; `react-markdown`, `rehype-slug`, `github-slugger`, `@panzoom/panzoom` as direct dependencies |
| 16 | Rehearsal setup and scorecard (70) | `Content maxWidth="lg"` > `Header` > form (mode as cards, questions, two switches, Start). Scorecard: `Result`, `Statistic` row, `Descriptions`, `List` of reveals | `rehearsalSetupForm: FormConfig` built from `FORMATS` in `config.ts` and `rehearsalFormatSchema` (`radio` `appearance: "card"`, `select` ×2 with option sets from the studio lists, `switch` ×2); `scorecardItems` | `use-rehearsal.ts` over `createRehearsalClient` and `material.ts` | the app-made `Toggle`; `rehearsal.css` 468 lines with page 17; 10 form elements |
| 17 | Rehearsal running (71) | `Header` with `StatusClock` and `Progress`; `Steps` for the parts; `Panel` with the prompt (`Markdown`); answer as `Textarea` or `CodeEditor`; hint `Button`s with `Popconfirm` (a hint costs points) | `hintActions: ActionDescriptor<{ revealed, remaining }>[]` | `use-rehearsal-run.ts` (timer, reveals, finish) | the rest of `rehearsal.css`; 71 layout, 74 `className`, 6 styles |
| 18 | Live setup (80) | `Content maxWidth="lg"` > one form in sections (`section: "card"`): what it is for and how Studio hears (`radio` cards), consent `checkbox`, sources `switch` each, policy and retention `select`, capability notes as `staticPanel`; capability table as `Table size="small" pagination={false}`; pairing as `Card` with `QRCode` | `liveSetupForm: FormConfig` from the session-start contract in `live-session.ts`; `capabilityColumns`; option availability from `setup-model.ts` as `optionDisabledReasons` | `use-live-setup.ts` over `use-setup-choices.ts` and `session-client.ts` | `setup.css` 433, `pairing.css` 39; the two hand-made segmented controls |
| 19 | Live session running and ended (81, 83) | Running: library `SessionBar`, `Tabs` (Transcript / Sources / Activity), `Transcript`, `Empty variant="tile"`, `Alert` for banners, tasks as `Collapse` of `Card`s with `Tag` claims. Ended: `Descriptions`, `Table` for results (expandable rows) and history, `Popconfirm` for delete and retention | `sessionTabs`, `resultColumns`, `historyColumns`, `bannerCopy` (exists in `banner-copy.ts`), `endedActions` | `use-live-session.ts` exists; it stays the one controller, with `session-actions.ts` as its action map | 11 stylesheets of 2,622 lines in total with page 18; 278 layout, 151 text, 76 list, 42 control, 455 `className`, the one raw `table` |
| 20 | Native panel `/live/overlay` (90) | Finish the native swap: start panel as a form (LIB-06 cards), code canvas on `CodeEditor`, answer dock and tests drawer on `Panel` and `Drawer`, Settings on one form with the behaviour flags | `BEHAVIOUR_FLAGS` already drives Settings; the start panel takes `liveSetupForm` | the overlay's existing store and hooks | 4 stylesheets of 1,971 lines; 176 layout, 234 `className`, 46 styles; the two `STYLE` tables; the raw `select`s |

### Presentation: 2 TSX files (2,970 lines), 112 layout, 64 text, 107 form, 74 control, 115 `className`, 5 styles, `presentation.css` 716 lines

| # | Page (shots) | Composition | Data | Controller | Deleted |
|---|---|---|---|---|---|
| shell | every page | section 4.2 "App shell" with a five-item `Menu` and the product links as `href` items | `presentationNavigation: MenuItem[]` | none | `StudioPage`, `ProductLinks`, `ReferenceHeader` markup |
| 21a | `/library` (100) | prompt form in a `Card`; `Table` with `title` toolbar (`Segmented` All / Recent / Favourites, `Segmented` Grid / List, sort); grid view as `Row minItemWidth` of `Card`s; `Empty` | `promptForm: FormConfig` (`textarea`, `select` ×4 with option sets); `deckColumns: TableConfig<PresentationSummary>`; `deckActions` | `use-presentation-library.ts` | five raw `select` chips, filter buttons |
| 21b | `/create` (101) | one form with `section: "card"` groups | `createForm: FormConfig` from `CreatePresentationInput` (a Zod contract is added beside the interface) | `use-presentation-create.ts` | the hand-built form |
| 21c | `/editor` (102) | `Splitter` > `Panel` slides (`OutlineList`) / canvas (allow-listed slide surface) / `Panel` properties (form) ; `Toolbar` with export `Dropdown` and share `Modal`; agent box as `Textarea` with a send `Button` | `slidePropertiesForm` per slide layout; `editorActions: ActionDescriptor<{ dirty, selected, exporting }>[]` | `use-presentation-editor.ts` (save with the conflict error kept, undo, export) | the largest share of the 107 form elements |
| 21d | `/themes` (103) | form (`text` ×2, `file`, `color`) and `Row minItemWidth` of theme `Card`s | `themeForm: FormConfig` | `use-themes.ts` | the native file input |
| 21e | `/images` (104) | form and `Masonry` of `Image preview` | `imageForm: FormConfig` | `use-image-studio.ts` | hand-built form and results |
| 21f | `/present` (105) | slide surface allow-listed; controls as `IconButton`s in a `Toolbar variant="floating"` | `presentActions` | `use-present-mode.ts` (keys, index) | raw buttons |
| 22 | `/shared`, `/share/presentation/:token` (106, 05) | read-only slides; `Result status="error"` for an unknown token | none | none | the error line markup |

## 6. Boundaries

The frontend rule for every page order: a view imports its config, its controller and library
parts; a controller imports a typed client and contracts; nothing under `frontend/` calls `fetch`
or `studioFetch` except a client module. Measured today in the route modules (query-builder calls /
raw SQL statements / `withTenant` or `tenantTransaction` calls):

| Page | Client (frontend) | Route module today | What must move | Order |
|---|---|---|---|---|
| Home | `createPlanClient` (in use) | `plan/api.ts` 167 lines: 0 / 0 / 0; `plan/repository.ts` exists | Use cases (create interview, add, patch, reorder, complete item) into `plan/plan.service.ts`; the route parses and delegates | BE-01 |
| Workspace, recent lists, Playground control | `studioFetch` in `studio.tsx:54`, `use-studio-lists.ts:40`, `workspace-view.tsx:151`, `use-canonical-draft.ts:80,253`, `playground-control.ts`, `use-playground-control.ts` | `api.ts` 1,243 lines, 49 routes: 3 / 0 / 0 | A `createWorkspaceClient` in `packages/interview-api-client`; the three builder calls and the run, version and guide use cases into `workspace/workspace.service.ts` and the existing repositories | BE-04 (client first, then service) |
| Briefings | `createBriefsClient`, `createBriefingClient` | `briefs/api.ts` 164: 0 / 0 / 0; `briefing/api.ts` 1,049: 1 / 0 / 0; `briefing/repository.ts` exists | Prepare, condense, propose, apply and save into `briefing/briefing.service.ts`; the one builder call into the repository | BE-03 |
| Documents | `documents-client.ts` (typed, stays) | `documents/api.ts` 2,228 lines, 32 routes: 5 / **22** / 11; `documents/repository.ts` exists | All 22 raw statements and the 11 tenant scopes out of the route module into `documents/repository.ts`; editing, review and generation use cases into `documents/document.service.ts`. The compare-and-swap on `currentRevision` stays one tenant transaction | BE-05: the target architecture's slice, owned by the workers on it |
| Knowledge | none: `library.tsx:48` calls `studioFetch` | `library-service.ts` over the JSON repository; no SQL | A `createLibraryClient` in `packages/interview-api-client` | KNO-01 |
| Rehearsal | `createRehearsalClient`; `rehearsal/material.ts:74` calls `studioFetch` | `rehearsal/api.ts` 191: 0 / 0 / 0 | `material.ts` through the workspace client; nothing on the server | REH-01 |
| Live setup, session, ended | `session-client.ts` (typed) | `live-session/routes.ts` 832: 1 / 0 / 1; `ingest.ts` 1,010 with raw SQL; 18 files under `live-session/` hold raw statements | The target architecture's backend example; under way now by other workers, outside this plan | BE-06 |
| Interview brief, pack review | `interview-brief-client.ts`, `pack-review-client.ts` | `brief/routes.ts` 564: 2 / 0 / 2 | The two builder calls into `brief/repository.ts` | BE-06 |
| Presentation | `fetch` inside `frontend/index.tsx` | `backend/api.ts` 793 lines, 40 routes: 2 / 0 / 0; `application/index.ts` and `repositories/index.ts` exist | A typed `presentation-client.ts` in the product's frontend; the two builder calls into `repositories/`; Zod contracts beside the `domain` interfaces | BE-02, PRE-00 |
| Shell pages | server components | `apps/web/app/api/**` | nothing | none |

Tripwires. Three exist, the third added by other workers while this was written:
`scripts/raw-sql-guard.test.ts` (raw SQL only in listed files, with a cap),
`scripts/ui-migration-audit.ts` (retired symbols; raw buttons, dialogs and tables per file) and
`scripts/application-boundaries.ts` for ADR-0042, whose debt ledger
`scripts/application-boundaries-debt.ts` may only shrink. The ledger's lists are the counts each
order must lower: `sqlOutsideRepositories` and `persistenceInTransport` for the BE orders,
`handBuiltUi` (per screen directory: `layout`, `className`, `style`, `cssImport`, `stylesheet`,
`field`) and `rawForms` (per file) for the page orders. This plan changes none of those scripts.
Two consequences:

1. The ledger is one file, so page orders do not edit it. Each hands back its directory's new
   counts, and the steward lowers the numbers once per wave (E-01, E-02, E-03). The test also
   fails on a number above what exists, so a wave cannot be merged with the ledger stale.
2. Two rules the plan relies on are asked of the tripwire's owners, not added here: an import of
   `message` or `notification` from the library fails; `fetch(` or `studioFetch(` in a frontend
   file that is not a `*-client.ts` fails.

## 7. Work orders

### 7.1 Rules common to every app order (part of each instruction)

> Read `AGENTS.md`, `bionic/objectives.md`, this brief's sections 4 to 6 and your row in section
> 5. Work in the `web-redesign` worktree. Edit only the files your order owns; if you need another
> file changed, stop and say so in the handback. Use only parts exported by
> `@oc-tech/omni-ui-components` and its `./dynamic-form`, `./chat`, `./highlight` (and later
> `./code-editor`) entries: no `className`, no `style`, no raw HTML element, no `.css` import, no
> `fetch` outside a client module. If a part is missing, stop and report the gap: never work
> around it. Views hold no rule and no request: rules go to the config (availability) or the
> controller (behaviour). Do not edit test files: a tester owns them and has already made them
> select by role and name. Delete the stylesheet and the old component in the same change.
> Finish with `pnpm verify:core` green for the packages you touched, and hand back: files changed,
> lines deleted, your files' counts of raw elements, `className` and `style` (all zero unless
> allow-listed here), and one row per interactive control (`where`, `role`, `name`, what it
> claims, the effect that proves it) for the claims inventory. Do not commit.

Rules for a tester order:

> Before the page changes, make its existing tests select by role, accessible name and
> `data-field`, never by class, without loosening an assertion; add a test for each behaviour the
> page has and no test covers (list them in the handback). After the page order lands, add one
> component test per form (the schema draws its fields, the contract rejects bad input, submit
> gives the typed payload, an API error shows) and one per controller (a stale response is
> dropped, an error state, each action's availability). You own the test files only.

Two orders never own the same file at the same time. Where a file passes from one order to the
next, the second names the first as a dependency.

Acceptance, the same four checks for every page order: (a) the page's component tests pass
unchanged; (b) the directory's `handBuiltUi` numbers and the files' `rawForms` entries in the
debt ledger fall to the numbers handed back (zero for the order's own files, entries deleted); (c) the claims rows are added and `claims-coverage.spec.ts`
passes (new rows may be `pending`; none may be missing); (d) `web-pages.spec.ts` is re-run for
the page and compared with its baseline shots: same content and controls, no sideways overflow
(`overflowPx` is 0 in `shots.json`), dark and light, 1280 and 480.

"16th" column: **yes** = may be implemented in the worktree before 2026-10-16. **no** = not
started before the 16th, because it touches the live session path, the native window, sign-in, or
a file the path loads (`studio.tsx`, `sidebar.tsx`, `platform-shell.tsx`, `live/**`,
`interview-brief/**`). **merge** = also safe to merge to `master` before the 16th (tests, new
files nothing imports, scripts).

### 7.2 Stewardship, tests and the browser suite

| Order | What | Files owned | Depends on | 16th | Acceptance |
|---|---|---|---|---|---|
| APP-01 | `ui:sync` script like `engine:sync`; it also writes the library commit into `vendor/README.md` | root `package.json` (scripts), `vendor/README.md` | none | merge | Running it twice gives the same tarball name and records the commit |
| APP-02 | Baseline spec: an output folder from `SHOTS_OUT`, a per-page filter from `SHOTS_ONLY`, and seeds for the states "not reached" (a document, a deck, a finished rehearsal, a share link) | `bionic/briefs/assets/web-library-only/web-pages.spec.ts`, `playwright.config.ts` | none | merge | `shots.json` lists no unreached page except `global-error` |
| APP-03 | Split the claims inventory by page without changing a row: `claims/pages/<page>.ts` composed in `claims.ts`; the same for `scan-states.ts` | `e2e/live-session/src/claims/**` | none | merge | `claims-coverage.spec.ts` passes with the same count of claims |
| RV-1 | Re-vendor 1 with `pnpm ui:sync` into the worktree, `pnpm install`, `pnpm verify` | `vendor/omni-ui-components/*`, `pnpm-lock.yaml` | LIB-12, APP-01 | yes | The whole browser suite passes, the native specs included; the library's 10 native captures did not change |
| RV-2 | Re-vendor 2 | as RV-1 | LIB-16 | no | as RV-1 |
| T-01 | Tester: Home, Rehearsal | `studio/home/*.test.tsx`, `studio/rehearsal/*.test.tsx` | none | merge | section 7.1 |
| T-02 | Tester: Knowledge, signed-out, settings, not found | `library.test.tsx`, `markdown-*.test.tsx`, `apps/web/app/signed-out/*.test.tsx`, `apps/web/app/pages.test.tsx`, `root-pages.test.tsx` | none | merge | section 7.1 |
| T-03 | Tester: Presentation | `products/presentation/src/frontend/*.test.tsx` | none | merge | section 7.1 |
| T-04 | Tester: Briefings, Documents | `studio/briefings/**/*.test.tsx`, `studio/documents/*.test.tsx` | none | merge | section 7.1 |
| T-05 | Tester: Studio shell, account, sign-in | `studio/*.test.tsx`, `studio/account/*.test.tsx`, `studio/shared/*.test.tsx`, `studio/config/*.test.tsx`, `apps/web/app/sign-in/*.test.tsx`, `apps/web/src/platform/platform-shell.test.tsx` | none | no | section 7.1 |
| T-06 | Tester: Workspace, web Live page | `studio/workspace/*.test.tsx`, `studio/live/*.test.tsx` (not `overlay/`) | none | no | section 7.1 |
| E-01 | Steward, wave 2: add the handed-back claims rows and scan states for the pages of wave 2; lower the debt ledger | `e2e/live-session/src/claims/pages/{home,rehearsal,knowledge,briefings,documents,presentation,shell-pages}.ts`, `scripts/application-boundaries-debt.ts` (the `handBuiltUi` and `rawForms` lists), the allow-list of `ui-migration-audit.ts` | wave 2 orders, APP-03 | yes | `claims-coverage.spec.ts` passes; the audit prints the lower counts |
| E-02 | Steward, wave 4 | the same for `{studio-shell,workspace,live,sign-in}.ts` | wave 3 and 4 orders | no | as E-01, and `E2E_STRICT=1` for the live rows touched |
| E-03 | Steward, wave 5 | the same for the native rows | wave 5 orders | no | as E-02; the hit-region and glass tests pass |
| V-01, V-02, V-03 | Screenshot check for waves 2, 4 and 5: run `web-pages.spec.ts` into `shots-after/`, lay each page beside its baseline, list differences that are not the intended look | `bionic/briefs/assets/web-library-only/shots-after/**` | the wave's orders | V-01 yes; others no | A written list per page: same, intended, or defect; the owner signs Presentation's new look |

### 7.3 Shell, apps/web and shared config

| Order | What | Files owned | Depends on | 16th | Tripwire target |
|---|---|---|---|---|---|
| SH-01 | The shared types and navigation data: `page-config.ts` (section 4.1; it imports `FormSchema` and `FormUiSchema` from the existing `studio/shared/contract-form.ts` and does not copy it) and `navigation.ts` (`navigationItems`, `paletteItems`) | new `studio/config/page-config.ts`, `navigation.ts` | none | merge | new files at zero |
| SH-02 | Extract `use-studio-shell.ts` from `studio.tsx` with no change to what is drawn | `studio/studio.tsx`, new `studio/use-studio-shell.ts` | T-05 | no | none |
| SH-03 | Sidebar on `Sider` + `Menu` from `navigationItems` | `studio/sidebar.tsx` | SH-01, RV-1, T-05 | no | `sidebar.tsx` to zero |
| SH-04 | Frame, header and dock on `Layout`, `Header`, `Content`, `Splitter`; delete the two resizers | `studio/studio.tsx`, `resizer.tsx`, `dock-resizer.tsx`, `studio-base.css` (frame rules only) | SH-02, SH-03 | no | `studio.tsx` to zero; `studio-base.css` under 150 lines |
| SH-05 | Palette on `Modal` + `CommandPopover` | `studio/command-palette.tsx` | SH-01, RV-1 | no | file to zero |
| SH-06 | Account menu, sign-out dialog, welcome banner | `studio/account/*.tsx`, `account-model.ts`, `account.css` (deleted), new `use-account.ts` | RV-1, T-05 | no | folder to zero; 188 CSS lines gone |
| WEB-01 | Signed-out and not found | `apps/web/app/signed-out/signed-out-view.tsx`, new `apps/web/app/not-found.tsx` | RV-1, T-02 | yes | both files to zero |
| WEB-02 | Integrations settings | `apps/web/app/t/[tenantSlug]/settings/integrations/page.tsx`, new `integrations-view.tsx` beside it | RV-1, T-02 | yes | both to zero |
| WEB-03 | Sign-in | `apps/web/app/sign-in/sign-in-view.tsx`, `last-used.tsx`, `apps/web/app/auth-icon.tsx` | RV-2, T-05 | no | to zero except the allow-listed `form` and hidden inputs |
| WEB-04 | `PlatformShell` draws a fragment | `apps/web/src/platform/platform-shell.tsx` | SH-04, PRE-01 | no | to zero |
| WEB-05 | Delete `auth-*`, `platform-*`, `.studio-*`, `.presentation-*` rules; drop the product stylesheet imports that are gone | `apps/web/app/styles.css`, `apps/web/app/layout.tsx` | WEB-01 to WEB-04, CL-01, PRE-08 | no | `styles.css` deleted or under 20 lines |

### 7.4 Interview Studio pages

| Order | What | Files owned | Depends on | 16th | Tripwire target |
|---|---|---|---|---|---|
| HOME-01 | Config and controller | new `home/home-config.ts`, `home/use-home.ts` | SH-01 | merge | new files at zero |
| HOME-02 | Home view | `home/home-view.tsx`, `interview-card.tsx`, `plan-card.tsx`, `home.css` (deleted) | HOME-01, RV-1, T-01 | yes | 49 layout, 15 form, 55 `className`, 245 CSS lines to zero |
| REH-01 | Config and controllers; `material.ts` through a client | new `rehearsal/setup-config.ts`, `use-rehearsal.ts`, `use-rehearsal-run.ts`; `rehearsal/material.ts` | SH-01 | merge | new files at zero; one `studioFetch` gone |
| REH-02 | Setup and scorecard | `rehearsal/rehearsal-view.tsx`, `scorecard.tsx` | REH-01, RV-1, T-01 | yes | files to zero |
| REH-03 | Running view | `rehearsal/live-session.tsx`, `rehearsal.css` (deleted), `practice-timer.tsx` | REH-01, RV-1, T-01 | yes | 74 `className`, 6 styles, 468 CSS lines to zero. `Textarea` for a code answer until RV-2 |
| KNO-01 | Library client, config, controller | new `packages/interview-api-client/src/library.ts`, new `studio/knowledge/knowledge-config.ts`, `use-knowledge.ts` | SH-01 | merge | new files at zero |
| KNO-02 | Browse view | `frontend/library.tsx`, `studio/library.css` (deleted) | KNO-01, RV-1, T-02 | yes | 64 `className`, 852 CSS lines to zero. Mounts `<Article slug basePath onBack />` from KNO-03 |
| KNO-03 | Article | new `studio/knowledge/article.tsx`; `markdown-content.tsx`, `shiki-highlighter.ts`, `studio/knowledge.css` (all deleted) | KNO-01, RV-1, T-02 | yes | 554 + 71 + 172 lines deleted; four direct dependencies removed from `products/interview/package.json` |
| BRI-01 | Config and controllers | new `briefings/briefings-config.ts`, `use-briefings.ts`, `behavioural/use-behavioural-pack.ts`; `behavioural/config.ts` | SH-01 | merge | new files at zero |
| BRI-02 | List, concept and new brief | `briefings/briefings-view.tsx`, `brief-card.tsx`, `new-brief.tsx`, `explanations-pane.tsx`, `briefings.css` (deleted) | BRI-01, RV-1, T-04 | yes | 235 CSS lines to zero |
| BRI-03 | Behavioural setup, questions, matrix | `behavioural/setup-card.tsx`, `questions-card.tsx`, `matrix-picker.tsx` | BRI-01, RV-1, T-04 | yes | 19 form elements, 2 raw forms to zero |
| BRI-04 | Pack, tabs, answers | `behavioural/behavioural-pack.tsx`, `briefing-tabs.tsx`, `answers-tab.tsx`, `behavioural.css` (deleted) | BRI-03 | yes | 236 `className`, 1,134 CSS lines to zero |
| DOC-01 | Config and controller | new `documents/documents-config.ts`, `use-documents.ts` | SH-01 | merge | new files at zero |
| DOC-02 | Documents view and list | `documents/documents-view.tsx`, `documents-list.tsx` | DOC-01, RV-1, T-04 | yes | files to zero |
| DOC-03 | New document dialog | `documents/new-document-dialog.tsx`, `creation-mode.ts` | DOC-01, RV-1, T-04 | yes | 705-line file to a composition; to zero |
| DOC-04 | Template library and editor | `documents/template-library.tsx` | DOC-01, RV-1, T-04 | yes | file to zero |
| DOC-05 | Document editor: the target architecture's slice in its four frontend steps (config, form, controller, composition) | `documents/document-editor.tsx`, new `document-form.tsx`, `document-form-config.ts`, `use-document-editor.ts` | LIB-09 through RV-1; BE-05 | no (owned by the slice's workers) | editor to zero; the ten regression cases of the target architecture hold |
| DOC-06 | Delete the local kit | `documents/documents-ui.tsx`, `documents.css`, `document-writing.tsx` | DOC-02 to DOC-05 | no | 175 + 595 lines deleted |
| WRK-01 | Config and controller; workspace client | new `packages/interview-api-client/src/workspace.ts`, new `workspace/workspace-config.ts`, `use-workspace.ts` | SH-01 | no | new files at zero |
| WRK-02 | New question and stage panes | `workspace/new-question.tsx`, `stage-panes.tsx`, `inline-text.tsx` | WRK-01, RV-1, T-06 | no | files to zero |
| WRK-03 | Code panel on `CodeEditor` and `Tabs` | `workspace/code-panel.tsx` | WRK-01, RV-2, T-06 | no | file to zero; CodeMirror imports gone |
| WRK-04 | Workspace view, versions, assistant change | `workspace/workspace-view.tsx`, `versions-menu.tsx`, `assistant-change.tsx`, `use-canonical-draft.ts`, `workspace.css` (deleted) | WRK-02, WRK-03 | no | 129 `className`, 980 CSS lines to zero; three `studioFetch` calls gone |
| LIV-00 | Find and delete what ADR-0033 left dead on the web Live page; list every file with its users | handback only, then deletions it names | T-06 | no | a deletion list; the suite passes |
| LIV-01 | Setup config and controller | new `live/setup-config.ts`, `use-live-setup.ts` | SH-01, LIV-00 | no | new files at zero |
| LIV-02 | Setup view | `live/setup-view.tsx`, `setup-sections.tsx`, `setup-controls.tsx`, `setup-footer.tsx`, `capability-table.tsx`, `companion-report.tsx`, `pairing-panel.tsx`, `setup.css`, `pairing.css` (deleted) | LIV-01, RV-1 | no | 472 CSS lines to zero; the raw `table` gone |
| LIV-03 | Session frame, bar, tabs, banners | `live/live-view.tsx`, `live-session-view.tsx`, `session-bar.tsx`, `session-tabs.tsx`, `session-banner-list.tsx`, `run-notices.tsx`, `end-confirm.tsx`, `session-bar.css`, `session-tabs.css`, `live.css` (deleted) | LIV-00, RV-1 | no | 614 CSS lines to zero |
| LIV-04 | Transcript, sources, activity tabs | `live/transcript-tab.tsx`, `sources-tab.tsx`, `activity-tab.tsx` | LIV-00, RV-1 | no | files to zero |
| LIV-05 | Task panels, answers, claims | `live/task-panels.tsx`, `answer-body.tsx`, `coding-panel.tsx`, `claim-chips.tsx`, `session-claims.css` (deleted) | LIV-00, RV-2 | no | files to zero |
| LIV-06 | Drafts and the Workspace hand-off | `live/session-draft-panel.tsx`, `session-draft-workspace.tsx`, `workspace-handoff.tsx`, `workspace-handoff.css` (deleted) | WRK-04 | no | files to zero |
| LIV-07 | Ended view, results, history, retention | `live/ended-view.tsx`, `ended-results.tsx`, `ended-history.tsx`, `ended-retention.tsx`, `ended.css` (deleted) | LIV-00, RV-1 | no | 228 CSS lines to zero |
| LIV-08 | Shared live parts (also used by the native window) | `live/shared/*.tsx`, `shared/screenshots.css`, `shared/capture-problem.css` (deleted) | LIV-00, RV-1 | no | 482 CSS lines to zero |
| LIV-09 | Delete `session-view.css` once nothing uses it | `live/session-view.css` | LIV-03 to LIV-08 | no | 496 CSS lines to zero |
| NAT-00 | Inventory of `overlay/` file by file (36 TSX files) and a split of `panels/` (31 files) into three sets with no shared file | handback only | E-02 | no | three file lists |
| NAT-01 | Start panel on a form | `overlay/panels/start-panel*` | NAT-00, RV-2 | no | 292 CSS lines to zero |
| NAT-02 | Code canvas on `CodeEditor` | `overlay/code-canvas.tsx`, `code-canvas.css` (deleted) | NAT-00, RV-2 | no | 244 CSS lines to zero |
| NAT-03, NAT-04, NAT-05 | The three panel sets of NAT-00 | as NAT-00 lists | NAT-00, RV-2 | no | `panels.css` (1,396 lines) deleted by the last of them |
| CL-01 | Close-out: `tokens.css`, the rest of `studio-base.css`, `shared/dialog.tsx`, `ui/theme.css` if unused | those four files, `studio/index.ts` style exports | every page order | no | 703 + 388 lines deleted |
| CL-02 | The interview brief form on a shared form config, so the web and the native window use one schema (the native context modal already has `interview-context-form.ts`; follow it) | `studio/interview-brief/interview-brief-form.tsx`, new `interview-brief-config.ts` | NAT-01 | no | 17 hand-held fields become one `FormConfig` |
| CL-03 | Close the ledger: `handBuiltUi` empty, `rawForms` holding only sign-in, every `ui-migration-audit` allow-list entry gone except those of section 4.3; the reference page gains the page pattern of section 4.1 (ADR-0042 already states the rule) | `scripts/application-boundaries-debt.ts`, `bionic/research/references/application-boundaries.md` | CL-01 | no | `APPLICATION_BOUNDARIES_PRINT=1` prints empty lists for (f) and one entry for (g) |

### 7.5 Presentation

| Order | What | Files owned | Depends on | 16th | Tripwire target |
|---|---|---|---|---|---|
| PRE-00 | Split `frontend/index.tsx` (2,639 lines) by page with no change to what is drawn, and move its requests into `presentation-client.ts` | `frontend/index.tsx` (re-exports only afterwards), new `frontend/shell.tsx`, `frontend/pages/{library,create,editor,editor-properties,themes,images,present,shared}.tsx`, `frontend/presentation-client.ts` | T-03 | yes | no count rises; no `fetch` outside the client |
| PRE-01 | Add the library as a dependency; shell on `Layout`, `Sider`, `Menu` | `products/presentation/package.json`, `frontend/shell.tsx`, new `frontend/config/page-config.ts`, `navigation.ts` | PRE-00, RV-1 | yes | `shell.tsx` to zero |
| PRE-02 | Library page | `frontend/pages/library.tsx`, new `library-config.ts`, `use-presentation-library.ts` | PRE-01 | yes | file to zero |
| PRE-03 | Create page | `frontend/pages/create.tsx`, new `create-config.ts`, `use-presentation-create.ts` | PRE-01, BE-02 | yes | file to zero |
| PRE-04 | Editor frame: slides, toolbar, export, share, agent box | `frontend/pages/editor.tsx`, new `editor-config.ts`, `use-presentation-editor.ts` | PRE-01 | yes | file to zero except the allow-listed canvas |
| PRE-05 | Editor properties form | `frontend/pages/editor-properties.tsx`, new `slide-properties-config.ts` | PRE-01 | yes | file to zero |
| PRE-06 | Themes and images | `frontend/pages/themes.tsx`, `images.tsx`, new `themes-config.ts`, `images-config.ts`, `use-themes.ts`, `use-image-studio.ts` | PRE-01 | yes | files to zero |
| PRE-07 | Present mode and the shared view | `frontend/pages/present.tsx`, `shared.tsx`, new `use-present-mode.ts` | PRE-01 | yes | controls to library parts; slide surface allow-listed |
| PRE-08 | Delete the stylesheet and its package export | `frontend/presentation.css`, `products/presentation/package.json` (`exports`) | PRE-02 to PRE-07, V-01 signed | no (it changes `apps/web/app/layout.tsx` through WEB-05) | 716 CSS lines to zero |

### 7.6 Backend

| Order | What | Files owned | Depends on | 16th | Acceptance |
|---|---|---|---|---|---|
| BE-01 | Plan use cases into a service | `backend/plan/api.ts`, new `plan/plan.service.ts` | none | yes | the route tests pass unchanged; the route file holds no rule |
| BE-02 | Presentation: Zod contracts beside the interfaces; the two builder calls into `repositories/` | `products/presentation/src/domain/index.ts`, `backend/api.ts`, `repositories/index.ts`, `application/index.ts` | none | yes | request-level behaviour unchanged; `api.ts` holds no query |
| BE-03 | Briefing use cases into a service | `backend/briefing/api.ts`, `briefing/repository.ts`, new `briefing/briefing.service.ts` | none | yes | route tests unchanged; the raw SQL guard's count for `briefing/api.ts` is 0 |
| BE-04 | Workspace routes: use cases and the three builder calls out of `api.ts` | `backend/api.ts`, new `backend/workspace/workspace.service.ts` | WRK-01 (the client fixes the contract) | no | route tests unchanged |
| BE-05 | Documents: 22 raw statements and 11 tenant scopes out of `documents/api.ts` | `backend/documents/api.ts`, `repository.ts`, new `document.service.ts` | none | owned by the slice's workers | the ten regression cases; real PostgreSQL tenant and concurrency tests |
| BE-06 | Live session and interview brief: the target architecture's section 2 | `backend/live-session/**`, `backend/brief/**` | characterisation tests | under way now, by other workers (`ingest-characterisation.test.ts` and the new `contracts/`, `domain/`, `services/`, `repositories/`, `handlers/` folders are in the working tree); not an order of this plan | its own plan |

### 7.7 The instruction for each order

Each is given to the worker with the common rules of 7.1 in front.

**Library** (rules of section 3 in front; the row of section 3 is the specification):

- **LIB-01 to LIB-11, LIB-13, LIB-15**: "Implement the row `<id>` of section 3 of
  `BRIEF-web-app-redesign-on-the-library.md` exactly: the type signature, the behaviour, the named
  stories with a `play` for each interaction. Own only the listed files. Every new prop is
  optional and its absence renders today's markup. Do not write tests, the changelog or the
  overview row: hand back the changelog line and any new token rows."
- **LIB-12, LIB-16**: "Collect the handbacks. Write the changelog, journal, overview rows and
  token rows. Run `pnpm verify`, `pnpm test:storybook` and `pnpm test:visual`; a changed native
  capture is a defect to send back, not a baseline to update. Do not pack."
- **LIB-14**: "Add the `"use client"` banner to the built entries except `highlight`. Add a
  fixture that imports `Button` from a Next.js server component and builds. Own `vite.config.ts`
  and the fixture."
- **LT-01 to LT-07**: "Write the tests for the orders in your row of section 3 from the type
  signatures there, then run them against the implementation: behaviour, keyboard, roles and
  names, controlled and uncontrolled, and one snapshot proving that no new prop means today's
  markup. Own only the test files. Report an implementation that does not meet the signature; do
  not change it."

**Stewardship and tests**: APP-01, APP-02, APP-03, RV-1, RV-2, T-01 to T-06, E-01 to E-03 and
V-01 to V-03 take their row in 7.2 as the instruction, with the tester rules of 7.1 for T orders.

**Shell and apps/web**:

- **SH-01**: "Create the two files. `page-config.ts` holds the types of section 4.1 and nothing
  else; a `FormConfig`'s `schema` is always `contractFormSchema(contract, fields)` from
  `studio/shared/contract-form.ts`, which you do not edit. `navigation.ts` exports
  `navigationItems({ views, products, recent, indicators, current })` returning library `MenuItem`s
  (a view's `goKey` becomes `shortcut: ["G", key]`, `indicator: "session-open"` becomes
  `{ label: "Session in progress", tone: "danger" }`, products are a `group` of `href` items, recent
  questions a `group`) and `paletteItems({ commands, lists, context })` returning `CommandItem`s
  with `group` and `shortcut`. Pure functions; nothing imports them yet."
- **SH-02**: "Move the state and the `StudioActions` of `studio.tsx` into `use-studio-shell.ts`
  (palette, rail and pinned, focus, dock, leave guard, shortcuts). `studio.tsx` keeps its JSX
  unchanged. No visible change; `studio.test.tsx` and `studio-requests.test.tsx` pass untouched."
- **SH-03**: "Rewrite `sidebar.tsx` as `Sider collapsible` with `header` (brand, the jump
  `Button` with its `shortcut`), `Menu appearance="plain"` fed by `navigationItems`, and `footer`
  (account, theme `IconButton`). Keep its props. `aria-current="page"`, the product links' leave
  guard and the session dot's name must hold."
- **SH-04**: "In `studio.tsx` replace the frame with `Layout direction="row" fill`, the header
  with `Header title meta actions` keeping the portal slot for views, the view area with
  `Content scroll`, and both resizers with `Splitter resizable` whose sizes are the stored dock
  and sidebar widths. Focus mode still hides the sidebar. Delete `resizer.tsx`, `dock-resizer.tsx`
  and the frame rules of `studio-base.css`."
- **SH-05**: "Rewrite `command-palette.tsx` as `Modal` > `ModalContent` >
  `CommandPopover search placement="inline"` fed by `paletteItems`. Keep its props (`items`,
  `onClose`). Escape closes, Enter runs, focus returns to the opener."
- **SH-06**: "Account menu as `Dropdown` with an `Avatar` trigger fed by `accountMenuItems`;
  sign-out as `Modal`; welcome banner as `Alert`. Move the sign-out flow into `use-account.ts`.
  Delete `account.css`."
- **WEB-01**: "Signed-out as `Content center` > `Result` with a `Button asChild` link; add
  `app/not-found.tsx` as `Result status="warning"` with a home link. Each view file starts with
  `"use client"` until the library ships its banner."
- **WEB-02**: "Keep `page.tsx` a server component that loads the connected accounts and maps them
  to `IntegrationItem[]`; draw them in a new client `integrations-view.tsx` with `Content`,
  `Header` (title, a back link in `actions`) and `IntegrationList`."
- **WEB-03**: "Sign-in as section 5 row 1. Each provider stays its own server-action `form` (the
  only raw elements allowed, with their hidden inputs); the button inside is the library
  `Button type="submit"`. The expired and signed-out notices are `Alert`s. `web-signin-page.spec.ts`
  and `smoke-web-signin.spec.ts` pass unchanged."
- **WEB-04**: "`PlatformShell` returns its children in a fragment; keep every effect (theme,
  locale, AI profile, preferences)."
- **WEB-05**: "Delete the dead rule families from `styles.css` and the stylesheet imports of
  `layout.tsx` whose files are gone. Prove each family dead with the audit before deleting."

**Interview Studio pages**:

- **HOME-01**: "Create `home-config.ts`: `interviewForm` with
  `schema: contractFormSchema(interviewPlanInputSchema)`, two-column `ui:rows`, `dateTime`, `numberInput`, `tagInput`; `planItemForm`;
  `planItemActions: ActionDescriptor<PlanItem>[]` (open, complete, remove with `confirm`). Create
  `use-home.ts` over `usePlan` and the studio lists, returning `{ status, interview, items,
  recent, form, actions }`."
- **HOME-02**: "Rewrite the three view files as section 5 row 8 from `home-config.ts` and
  `use-home.ts`. `daysUntil` stays exported. Delete `home.css`."
- **REH-01**: "Create `setup-config.ts` (the setup form from `FORMATS` and `rehearsalFormatSchema`:
  card `radio`, two `select`s with option sets, two `switch`es), `use-rehearsal.ts` (setup, start,
  the Playground command, the saved scorecards) and `use-rehearsal-run.ts` (timer, reveals,
  score, finish). Route the request of `material.ts` through `createRehearsalClient` or the
  answers client; no `studioFetch` remains in the folder."
- **REH-02**: "Setup and scorecard as section 5 row 16. Delete the app-made `Toggle`."
- **REH-03**: "Running view as section 5 row 17, with `Textarea` for every answer for now. Delete
  `rehearsal.css`."
- **KNO-01**: "Add `createLibraryClient` to `packages/interview-api-client` for the routes
  `library.tsx` calls today, with tests like its neighbours. Create `knowledge-config.ts`
  (filters, the card mapping) and `use-knowledge.ts` (index, search, filters, the open article)."
- **KNO-02**: "Rewrite `library.tsx` as section 5 row 14; keep its props (`basePath`,
  `initialSlug`). It mounts `<Article slug basePath onBack />`. Delete `library.css`."
- **KNO-03**: "Create `studio/knowledge/article.tsx` exporting
  `Article({ slug, basePath, onBack })` as section 5 row 15: `Markdown headingAnchors` with
  `highlightLines` from `./highlight`, `Anchor` from `onOutline`, diagrams as `Image preview`.
  Delete `markdown-content.tsx`, `shiki-highlighter.ts`, `knowledge.css` and the four direct
  dependencies."
- **BRI-01, DOC-01, WRK-01, LIV-01**: "Create the page's config and controller files as its rows
  in sections 5 and 6 say: every form is a `FormConfig` whose schema is
  `contractFormSchema(<contract named in the row>)`, every
  list a `TableConfig`, every button an `ActionDescriptor` with its availability rule taken from
  the conditions the old view computes inline. The controller wraps the typed client named in
  section 6 and returns `{ status, data, form, actions, context }`. Nothing imports the files yet."
- **BRI-02, BRI-03, BRI-04, DOC-02, DOC-03, DOC-04, WRK-02, WRK-03, WRK-04, LIV-02 to LIV-08**:
  "Rewrite the files your row owns as the composition in your page's row of section 5, from the
  page's config and controller. Keep each exported component's props. Delete the stylesheet your
  row names."
- **DOC-05, BE-05**: "Follow sections 3 and 5 of
  `bionic/inbox/target-architecture-boundaries-and-vertical-slice.md` step by step; this brief
  adds only that preview selection uses `DynamicFormHandle.focusField`. `document-form-config.ts`
  already exists; do not rewrite it."
- **DOC-06, LIV-09, CL-01**: "Prove with the audit that nothing imports the files, then delete
  them."
- **LIV-00, NAT-00**: "Change nothing. Hand back the list your row asks for."
- **NAT-01 to NAT-05**: "Rewrite the files of your set from library parts only, keeping every
  `data-testid`, every hit region and the Swift drag probe's classes; run the native specs, the
  hit-region tests and `WindowDragTests`."
- **CL-02, CL-03**: the row is the instruction.

**Presentation**:

- **PRE-00**: "Move each exported page of `frontend/index.tsx` into its own file under
  `frontend/pages/` and the three shell functions into `shell.tsx`, changing no markup and no
  class. Move every `fetch` into `presentation-client.ts` with typed functions. `index.tsx`
  re-exports the same names. All existing tests pass untouched."
- **PRE-01**: "Add `@oc-tech/omni-ui-components` to the product (same `file:` tarball as
  `products/interview`). Rewrite `shell.tsx` as section 4.2 from `navigation.ts`."
- **PRE-02 to PRE-07**: "Rewrite your page as its row in section 5: a config file (forms as
  `FormConfig`s read from the contract BE-02 adds, lists as `TableConfig`, buttons as
  `ActionDescriptor`s), one controller over `presentation-client.ts`, and a view of library parts.
  The slide surface in `slide-blocks.tsx` is not yours and stays."
- **PRE-08**: the row is the instruction.

**Backend**:

- **BE-01, BE-03, BE-04**: "Characterise the routes first if a behaviour has no request-level
  test. Then move each use case into the service as a function that reads top to bottom
  (authorise, load under tenant scope, decide, persist through the repository, return); the route
  parses with the contract and delegates. No SQL or builder call remains outside the repository.
  Do not change a contract, a status code or a response body."
- **BE-02**: "Add a Zod schema beside each input interface in `domain/index.ts` and derive the
  type from it; parse requests with it in `api.ts`; move the two builder calls into
  `repositories/index.ts`."
- **BE-06**: not written here.

## 8. Dependencies

```
Wave 0   LIB-01..11 + LT-01..06        APP-01 APP-02 APP-03        SH-01
            |                           T-01 T-02 T-03 T-04         HOME-01 REH-01 KNO-01 BRI-01 DOC-01
            v                           BE-01 BE-02 BE-03           PRE-00
Wave 1   LIB-12 -> RV-1  (serial)
            |
            v
Wave 2   WEB-01 WEB-02   HOME-02   REH-02 REH-03   KNO-02 KNO-03
         BRI-02 BRI-03 -> BRI-04   DOC-02 DOC-03 DOC-04
         PRE-01 -> PRE-02..07      then E-01, V-01  (serial)
------------------------------ 2026-10-16: the owner's interview -----------------------------
Wave 3   LIB-13 LIB-14 -> LIB-15, LT-07 -> LIB-16 -> RV-2  (serial)
         T-05 T-06   SH-02 -> SH-03 -> SH-04   SH-05 SH-06   WRK-01 -> BE-04   LIV-00 -> LIV-01
            |
            v
Wave 4   WEB-03 WEB-04   WRK-02 WRK-03 -> WRK-04 -> LIV-06   LIV-02 LIV-03 LIV-04 LIV-05 LIV-07 LIV-08
         -> LIV-09   DOC-05 BE-05 -> DOC-06   PRE-08   then E-02, V-02  (serial)
            |
            v
Wave 5   NAT-00 -> NAT-01..05   CL-02   BE-06   CL-01 -> WEB-05 -> CL-03   then E-03, V-03  (serial)
```

## 9. Schedule

All implementation happens in one worktree branch, `web-redesign`. `master` is what the owner
runs on the 16th and receives only the orders marked **merge** before then. Whether the rest of
waves 0 to 2 merges before the 16th is the owner's decision after RV-1's gate; the plan does not
need it.

| Wave | Orders | Workers at once | Elapsed | Serial point |
|---|---|---|---|---|
| 0 | 34: LIB-01 to LIB-11, LT-01 to LT-06, APP-01 to APP-03, T-01 to T-04, SH-01, HOME-01, REH-01, KNO-01, BRI-01, DOC-01, PRE-00, BE-01 to BE-03 | 16 to 20 | about 2 hours | none |
| 1 | 2: LIB-12, RV-1 | 1 | 1 to 2 hours | the library's three gates, the pack, then the app's `pnpm verify` with the browser suite |
| 2 | 22: WEB-01, WEB-02, HOME-02, REH-02, REH-03, KNO-02, KNO-03, BRI-02 to BRI-04, DOC-02 to DOC-04, PRE-01 to PRE-07, E-01, V-01 | 12 to 14 | about 3 hours | PRE-01 before the six Presentation pages; E-01 and V-01 at the end |
| 3 | 17: LIB-13 to LIB-16, LT-07, RV-2, T-05, T-06, SH-02 to SH-06, WRK-01, BE-04, LIV-00, LIV-01 | 8 to 10 | about 3 hours | `studio.tsx` (SH-02, then SH-04); RV-2 |
| 4 | 19: WEB-03, WEB-04, WRK-02 to WRK-04, LIV-02 to LIV-09, DOC-05, DOC-06, BE-05, PRE-08, E-02, V-02 | 10 to 12 | about 4 hours | the browser suite with `E2E_STRICT=1` |
| 5 | 13: NAT-00 to NAT-05, CL-01 to CL-03, WEB-05, BE-06, E-03, V-03 | 6 to 8 | about 4 hours, without BE-06 | the native specs and the Swift tests |

Total: 107 orders. Before the 16th: 58 (waves 0 to 2), of which 13 may merge to `master`. After:
49.

The three bottlenecks, and how each is kept short:

1. **Re-vendoring the library.** One tarball, one lock file, one worker. Two re-vendors in the
   whole plan (RV-1, RV-2), never one per order. Anything a page order finds missing after RV-1
   goes on a list for RV-2; the worker reports it and moves on to another file.
2. **The shared shell.** `studio.tsx` is one 506-line file that the frame, the header, the dock
   and the palette state all live in. SH-02 empties it into a hook first, so SH-03, SH-05 and
   SH-06 run beside SH-04 on other files. Pages do not wait for the shell: they render inside
   whatever frame exists, which is why 20 page orders can finish before the shell starts.
3. **The browser suite.** `claims.ts` (2,318 lines) and `scan-states.ts` are single files, and a
   full run needs a build and a database container. APP-03 splits the inventory by page; page
   orders hand back rows instead of editing it; one steward order per wave (E-01 to E-03) adds
   them and runs the suite once. The screenshot check is the same: once per wave (V-01 to V-03).

## 10. Risks

| Risk | Mitigation |
|---|---|
| A re-vendor before the 16th changes the library the native window runs on | Every library change is an optional prop whose absence renders today's markup, proven by a snapshot per component (LT orders). RV-1 passes only if the library's 10 native captures are unchanged and the app's native specs pass. It lands in the worktree; `master` is not re-vendored before the 16th unless the owner says so |
| Workers on other refactors hold the same files (the documents slice, the live-session backend, two native forms, the tripwires) | DOC-05, BE-05 and BE-06 are named as theirs and are not duplicated here. The tripwire scripts are theirs; this plan asks for two rules of them (section 6) and only lowers the ledger through the steward. Before wave 2, the coordinator checks `git status` of `studio/briefings`, `studio/documents` and `backend/**` and holds an order whose files are in flight |
| The JSON Schema read from a contract gives something RJSF draws badly (`nullable` as `anyOf`, ISO date strings) | HOME-01 is the proof: its contract has a nullable date-time, a nullable integer and an array of strings. If the output needs shaping, the shaping goes into `contractFormSchema` once, by its owners, not into each page |
| DynamicForm pulls RJSF, AJV and Zod into every page | Import from `./dynamic-form` only in view files, which the studio already loads lazily after mount; RV-1 records the bundle size of the Home route before and after |
| Tests select by class and by 762 test ids | Tester orders run first and move selectors to roles and names; LIB-08 gives every field `data-field`; `Table`, `Toolbar`, `Panel` and `Toast` already take a test id |
| A page order finds a gap the plan missed | The rule in 7.1: stop, report, take another file. The gap becomes an option in RV-2. No workaround lands, because the audit locks a migrated file at zero |
| Presentation's look changes (its own dark palette becomes the library's tokens) | V-01 lays every Presentation page beside its baseline; PRE-08 (the stylesheet's deletion) waits for the owner's signature |
| Two workers write a config type differently | The three types live in one file from SH-01 (and its copy in Presentation from PRE-01), fixed in section 4.1 |
| Action availability moves into config and a rule is lost | A tester order adds one test per `ActionDescriptor` rule (drawn, hidden, disabled with its reason) from the old view's conditions before the swap |
| The estimate is optimistic for the largest orders (DOC-03 at 705 lines, PRE-04, LIV-08, the NAT sets) | Each may be split by its worker along component boundaries in the same folder, reported in the handback; no other order shares those files |

## 11. Could not be determined

- **What the other workers will touch next.** The working tree changed while this was written
  (ADR-0042, its tripwire, the live-session split, `document-form-config.ts`, two native forms,
  `contract-form.ts`). The plan was aligned with what was visible at the end; it was not
  coordinated with those workers, and an order here may already be partly done by them. The
  coordinator checks before handing out BRI, DOC, WRK-01, BE-03 and BE-04.
- **Whether the ledger's `handBuiltUi` numbers and the audit brief's inventory agree.** They count
  differently (the ledger is per screen directory and seeded today; the inventory is per page
  group). The "to zero" targets in section 7 hold for both; the starting numbers quoted are the
  inventory's.
- **The file-level split of the native window's `panels/` folder** (31 files). It was not read
  file by file; NAT-00 produces it.
- **How long `pnpm verify` and the browser suite take** on the owner's machine. The elapsed times
  in section 9 assume about 30 minutes for each serial gate.
- **Whether `@rjsf/shadcn` draws `anyOf` for nullable fields acceptably.** Not run; HOME-01 finds
  out (see Risks).
- **The Storybook on port 6006** was not opened or queried. Every statement about the library is
  from its source at `dcdb018`.
- **The states the baseline screenshots did not reach** (document editor, a deck in the editor,
  the scorecard, a session with tasks): their designs in section 5 are from source, not from an
  image. APP-02 adds the seeds.
- **The smallest supported width.** 480 is assumed (section 4.3).
