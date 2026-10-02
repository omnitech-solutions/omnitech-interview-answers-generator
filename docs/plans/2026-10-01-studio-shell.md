# Interview Studio shell (redesign sub-project 1 of 6)

Status: design approved in conversation 2026-10-01; spec awaiting review. Audited on `master` at `f18272f`.

## Context

The "Interview Studio" design (exported prototype, `~/Downloads/Interview Studio.html`) replaces the Interview product's chrome and every view. The redesign is split into six sub-projects, each with its own spec, plan and browser-verified delivery:

1. **Studio shell and design system** (this spec)
2. Workspace: typed answer `guide`, stage stepper, per-test results
3. Home: `interviews` and `prep_plan_items` records
4. Briefings: typed briefing cards, kinds, practice timer
5. Knowledge restyle
6. Rehearsal: formats, sessions, scorecard

Decisions already made for the whole redesign: it targets the Vite assistant host (`apps/frontend`, `http://127.0.0.1:5175/t/local/p/interview`), not `apps/web`. The design is implemented in full with real data, driven by config and data rather than hard-coded content. Each view is replaced incrementally inside the product package.

## Outcome and completion checklist

The assistant host renders a full-window Studio shell matching the design: a sidebar, a main view, and a docked assistant. Today's views are mounted inside it unchanged.

- [ ] `<Studio>` is the single public entrypoint; `apps/frontend` renders it, and the "Question identifier" nav bar is removed.
- [ ] View and command registries drive the sidebar nav, palette and shortcuts; no view or command is hard-coded in components.
- [ ] Sidebar: brand ("Interview Studio · Omnitech · Local"), "Search or jump to… ⌘K", nav for 5 views, Recent questions (live data, top 6, neutral status dots until sub-project 2), local identity ("Local user" with "local · {artifact}"), theme toggle.
- [ ] ⌘K command palette with Go to / Actions / Questions / Briefings groups, filtering, ↑↓/Enter/Esc.
- [ ] Shortcuts: ⌘K, ⌘J, ⌘↵ (Workspace), `N`, `G H|W|B|K|R`; non-modifier shortcuts are inert while typing.
- [ ] Docked real assistant on every view (⌘J), 400px, theme-synced. The per-view "sees: …" label is rendered by the shell beside its Assistant toggle, not inside the package's header.
- [ ] View, and artifact where relevant, in the URL, with working back/forward.
- [ ] Design tokens for light and dark, Geist fonts and SVG icons, with omni-ui variables mapped to the tokens so embedded views adopt the palette.
- [ ] `GET /api/interview/workspaces/:ws/artifacts` listing drafts (scoped and newest first).
- [ ] Library GET routes reachable on the assistant host; library writes still refused.
- [ ] A per-view error boundary, plus loading, error and empty states for the lists.
- [ ] Tests listed below; `pnpm verify` green; browser checks below performed in the operator's Chrome session.

Non-goals: redesigning the inside of any view (sub-projects 2–6), changes to `apps/web`, new data models, changes to the vendored `@omnitech-assistant/*` tarballs, mobile layouts below 600px.

## Audited facts

| Concern | Evidence | Implication |
|---|---|---|
| Host entry | `apps/frontend/src/app.tsx` renders a nav bar plus `<Workspace key={artifact} assistant onPreparationDirtyChange>` | Replace with `<Studio>`; keep the artifact key remount and the dirty-preparation confirmation |
| View switching today | `workspace.tsx:317` `activeView` switches playground / concept-lab / interview-preparation / mock-interview inside Workspace; `studio-shell.tsx` owns nav drawer and theme | The shell takes over navigation; Workspace gets an embedded mode without its own top bar or drawer |
| Assistant | `AssistantRoot` config accepts `layout: { mode: "panel" \| "full", open, width }`, `theme`, and `host.onThemeChange`; `useAssistantHost()` exposes `open`, `toggle`, `shortcut`, `theme`, `setTheme` | The dock and ⌘J come from the package; the shell wraps everything in `AssistantRoot` |
| Host API surface | `apps/api/src/main.ts:562` passes only `generate`, `explain` and `syntax-check`; `:563` returns 501 for other `/api/v1/*` | Knowledge is broken on this host today; mount library GETs explicitly |
| Draft listing | `InterviewWorkspaceRepository` has `read`, `edit`, `save`, `listAnswerRevisions`, but no draft list | Add `listDrafts` |
| Briefings data | `/api/interview/briefing/*` is mounted (`main.ts:458`) | The palette's Briefings group lists saved packs from it |
| Icons | Design uses the Material Symbols Rounded font (3 MB woff2); the assistant package ships 74 SVG paths | Use a typed SVG registry instead of the font |

## Design

### Module layout

```
products/interview/src/frontend/studio/
  index.ts              public entrypoint: export { Studio }, type StudioProps
  studio.tsx            Studio: owns view state, theme, palette and toast; composes the parts below
  tokens.css            design tokens, light and dark; base primitives; omni-ui variable mapping
  config/views.ts       view registry
  config/commands.ts    command registry
  sidebar.tsx
  command-palette.tsx
  toast.tsx
  icon.tsx              typed SVG registry, about 40 Material Symbols Rounded icons
  use-shortcuts.ts
  use-studio-route.ts   URL ⇄ { view, artifact }
  use-studio-lists.ts   questions + briefings for sidebar and palette
  view-boundary.tsx     error boundary per view
```

`products/interview/src/frontend/index.ts` adds `export { Studio } from "./studio/index.js"`. Internal files are not imported from outside `studio/`.

### Registries

```ts
// config/views.ts
type ViewId = "home" | "work" | "briefings" | "knowledge" | "rehearsal";
type ViewDefinition = {
  id: ViewId;
  label: string;            // "Workspace"
  icon: IconName;           // "terminal"
  goKey: string;            // "W"  → shortcut "G W"
  assistantContext: string; // "question, code, tests"
  render(props: ViewProps): ReactNode;
};
export const views: readonly ViewDefinition[];

// config/commands.ts
type CommandContext = { view: ViewId; hasArtifact: boolean };
type Command = {
  id: string;
  group: "Go to" | "Actions";
  label: string;
  icon: IconName;
  shortcut?: string;        // "mod+k", "mod+enter", "n", "g w"
  when?(context: CommandContext): boolean;
  run(actions: StudioActions): void;
};
export const commands: readonly Command[];
```

`StudioActions` is the only mutation surface commands receive: `go(view)`, `openArtifact(id)`, `newQuestion()`, `runTests()`, `toggleTheme()`, `toggleAssistant()`, `openPalette()`, `startRehearsal()`. "Go to" commands are generated from `views`. Questions and Briefings palette groups are data rows rather than commands, built by `use-studio-lists`.

View mapping in this sub-project:

| id | label | icon | renders | assistantContext |
|---|---|---|---|---|
| home | Home | home | Continue list from `listDrafts` (interim) | prep plan |
| work | Workspace | terminal | `Workspace` with `chrome="embedded"` | question, code, tests |
| briefings | Briefings | lightbulb | `InterviewPreparation` / `ConceptLab` | briefing |
| knowledge | Knowledge | menu_book | `Library` | search results |
| rehearsal | Rehearsal | timer | `MockInterview` | nothing (rehearsal) |

### Composition and data flow

```
apps/frontend App
  └─ <Studio assistant={binding}>
       └─ AssistantRoot(config: client, origin, theme, layout {panel, 400}, host hooks)
            └─ .studio  [Sidebar | <ViewBoundary>{view.render()}</ViewBoundary> | (assistant dock)]
                 ├─ CommandPalette (portal, when open)
                 └─ Toast
```

- **Assistant config.** The Workspace-specific `AssistantRoot` config, including the host hooks `prepareSend`, `beforeApply`, `onApplied`, `onReverted`, `onPreview` and `onContextChange`, moves up to the shell. Workspace registers its hooks with the shell through a small context, `useStudioAssistantHooks(hooks)`, so they're only active while the Workspace is mounted. On other views those hooks are absent, and the assistant works without a bound draft editor.
- **Routing.** `use-studio-route` reads and writes `?view=&artifact=` on `/t/local/p/interview`. It uses `pushState` for navigation, listens for `popstate`, and defaults to `view=home`, `artifact=main`. Switching away from an artifact with dirty preparation keeps the existing `window.confirm` guard.
- **Lists.** `use-studio-lists` fetches drafts and saved briefings on mount, after Save or Apply (through a `refreshLists()` action the views call), and when the palette opens. It shows only the latest response and aborts requests it has replaced.

### Backend additions

1. `InterviewWorkspaceRepository.listDrafts(scope, workspaceId)` returns `Array<{ artifactId, title, language, updatedAt, revision }>`:
   - It runs within the existing tenant transaction and RLS scope.
   - It's ordered by `updated_at DESC` and limited to 50.
   - `title` is the first non-empty line of the question, truncated to 80 characters.
   - `language` is `answer.language`, or `null`.
   - It reads only from the existing `assistant_drafts` table, so no migration is needed.
2. `GET /api/interview/workspaces/:workspace/artifacts` on `apps/api` returns that list. The route uses the same scope resolution as the existing `path` routes.
3. `apps/api` mounts `GET /api/v1/library/search`, `/facets`, `/items` and `/items/:idOrSlug` through `createInterviewApi().fetch`, ahead of the 501 catch-all. Methods other than GET on `/api/v1/library/*` keep falling through to the 501 response.

### Visual system

- **Tokens.** `tokens.css` defines the design's tokens under `:root[data-theme="light"]` and `:root[data-theme="dark"]`, copied verbatim from the prototype:
  - `--app`, `--side`, `--surface`, `--subtle`, `--hover`
  - `--border`, `--border-soft`, `--border-strong`
  - `--text`, `--muted`, `--faint`
  - `--accent`, `--accent-soft`, `--accent-ink`, `--on-accent`
  - `--green`, `--red`, `--amber` and their `-soft` variants
  - `--code-bg`, `--code-border`
  - `--shadow`, `--pop`
- **Mapping existing styles.** A compatibility block maps the omni-ui and `apps/web/app/styles.css` variables used by today's views onto these tokens. Embedded views take on the palette without per-component edits.
- **Base type.** Geist at 14px with a 1.5 line height; Geist Mono for code and key hints.
- **Layout.** The sidebar is 244px and full height, the main area is `flex: 1`, and the dock is 400px. Below 900px the sidebar collapses to a 56px icon rail with tooltips, and the design's sidebar is hidden during a live rehearsal.
- **Icons.** `icon.tsx` exports `Icon({ name, filled?, size? })` over a `const` record of SVG path strings. Names come from the design; `filled` maps to the design's `FILL 1` icons.

### Shortcuts

`use-shortcuts` installs one `keydown` listener and matches commands by `shortcut`:

- `mod` means ⌘ on macOS and Ctrl elsewhere.
- Sequences such as `g w` must complete within 800ms.
- Non-modifier shortcuts are ignored while the event target is an `input`, `textarea`, `select`, `[contenteditable]` or `.cm-editor`.
- `mod+j` calls `useAssistantHost().toggle()`; the package's own shortcut is left in place, and a guard prevents double toggling.
- Esc closes the palette.

### Errors and states

- **Lists.** If a list fails to load, the sidebar shows "Couldn't load questions" with a Retry button; palette navigation still works.
- **Views.** `ViewBoundary` catches a render error in one view and shows "This view hit an error" with a "Reload view" button, which resets the boundary. The sidebar and assistant stay usable.
- **Empty states.** No questions shows "Your questions will appear here". A palette search with no results shows "No matches".
- **Privacy.** Nothing logs question text, code, prompts or model output.

## Testing

- `config/views.test.ts` and `config/commands.test.ts` cover the registry contracts:
  - ids are unique
  - every shortcut parses
  - `goKey` values are unique
  - `when` predicates are respected
  - every command's `run` calls only `StudioActions`
- `studio.test.tsx` mocks `@omnitech-assistant/react` with a fake host store, using the same pattern as `workspace-assistant-host.test.tsx`. It covers:
  - Navigation updates `?view=`; `popstate` restores the view.
  - ⌘K opens the palette; typing filters it; ↑↓ and Enter run a command; Esc closes it.
  - `g w` navigates, but not while focus is in a textarea.
  - ⌘J calls `host.toggle`.
  - The theme toggle persists, sets `data-theme` and reaches the assistant config.
  - Recent questions render from the listing; clicking one sets `artifact`; error and Retry work.
  - A throwing view is contained and can be recovered.
  - The dirty-preparation confirmation blocks switching artifacts.
- `workspace.test.ts` (Postgres fixture) covers `listDrafts`:
  - another actor's or tenant's drafts are excluded
  - results are newest first
  - the title is derived from the question
  - the limit is applied
- API route tests cover:
  - the drafts listing
  - library GETs succeed on the assistant host
  - library POSTs return 501
- The existing `workspace*.test.tsx` suites still pass, with Workspace in both default and `chrome="embedded"` modes.
- Gate: `pnpm verify`, including coverage thresholds.

## Browser verification

Prerequisites: the assistant API on `:8791` and the frontend on `:5175`, both started with `scripts/assistant-dev.mjs`, plus the operator's Chrome with Claude in Chrome connected.

Each check is recorded with a screenshot and the interaction performed:

1. The shell matches the design in light and dark: sidebar, spacing and colours.
2. Sidebar nav reaches all five views; back and forward restore them.
3. ⌘K palette: search, arrow keys, Enter running a command, Esc.
4. ⌘J toggles the dock on every view; the "sees:" label changes per view.
5. Recent questions lists real drafts; clicking one opens that artifact in the Workspace.
6. Knowledge search returns results on the assistant host.
7. Workspace inside the shell: generate, run tests and save all still work.

## Risks

- **Workspace embedded mode.** `workspace.tsx` is about 2,100 lines. The embedded mode only hides its top bar and navigation; its toolbar actions (Language, New, Save, Run) stay visible inside the view until sub-project 2.
- **Moving the assistant config.** The proposal, apply and undo tests in `workspace-assistant*.test.tsx` must keep passing; the hook registration context is the seam.
- **Size.** The estimate is about 1,200 changed lines including tests, which exceeds the 1,000-line checkpoint. That is accepted by approving this spec.

## Implementation notes (2026-10-01)

Deviations from the design above, found while building and checking in the browser:

- **Routing is path-based, not `?view=`.** `Library` rewrites the whole query string for its filters and pushes `/library/<slug>`. Views therefore live in the path: `/t/local/p/interview/<view>[/<rest>]`, with `?artifact=` used only by the Workspace. `Library` gained `basePath` and `chrome="embedded"` props: no brand, theme, ⌘K or authoring inside the shell.
- **No toast module.** Nothing in this sub-project raises one; it arrives with the first feature that does.
- **Header slot.** The shell header has an action slot. The embedded Workspace portals its toolbar into it (Language, New, Save answer, Run tests, inspector), so the page has a single top bar. The example-template picker stays standalone-only.
- **Inspector and narrow windows.** Inside the shell, the Workspace inspector is anchored under the header and capped at 60% of the main column. The sidebar collapses to an icon rail below 900px, and below 1400px while the assistant dock is open.
- **Shortcut ownership.** The assistant package binds ⌘K (its search) and ⌘J (toggle). The shell moves the package's search to ⌘⇧K and leaves ⌘J to the package.
- **Icons.** `scripts/generate-studio-icons.mjs` writes `icons.generated.ts` from `@material-symbols/svg-400` (dev dependency, Apache-2.0). The assistant sparkle uses the assistant package's own `Icon`.
- **Stylesheet.** `tsc -b` does not copy CSS, so the package exports `@omnitech/product-interview/studio.css` and the host imports it.
- **Dev CSP.** `apps/frontend/vite.config.ts` adds `'wasm-unsafe-eval'` to `script-src` so Shiki's WebAssembly highlighter runs. This was a pre-existing failure that became visible once Knowledge worked on this host.
- **API route checks.** `apps/api/src/main.ts` is a start-up script with no test harness. Its two new routes were checked against the running API with curl: the drafts listing returns real drafts, the library search succeeds, and a library POST returns 501. `listDrafts` itself is covered by the Postgres fixture test.
- **Not exercised in the browser:** Generate (a model call) and Save (writes an immutable answer version to the operator's data). Both go through the same shell binding that ⌘↵ exercised, and both are covered by component tests.
