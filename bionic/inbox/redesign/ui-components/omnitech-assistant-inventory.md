# omnitech-assistant UI feature inventory (read-only survey)

Root: `/Users/desoleary/dev/omnitech-solutions/omnitech-assistant`. Everything below was read directly from source. Paths are relative to `packages/react/src/` unless prefixed, and `C` = `components/`.

## 0. Headline findings

1. **There is no drag-and-drop upload and no per-file upload progress.**
   - Files attach through the picker, the paste handler, and the `+` menu (`C/Composer.tsx:197-209, 418-426, 685-708`).
   - Upload happens only at send time, inside `useAssistant.startRun` (`useAssistant.ts:285-290`). The UI shows a generic "Replying…" state and nothing per file.
   - The server's `AttachmentStatus` (`submitted|extracting|ready|failed`) is never rendered as a card state.
   - A library file card should still support `status` and `progress`, because the contract has them.
2. **"Connectors" are MCP server URLs, not OAuth connected accounts** (`C/Connectors.tsx`, `contracts/schemas.ts:179-190`). Each has `{id, name, url, enabled, status: connected|unreachable|off, tools?}`. The UI lists them, toggles them, removes them, and adds one by URL. There is no OAuth flow.
3. **The conversation view is hand-rolled and renders Turns, not flat messages.** `buildTurns` (`turns.ts:49`) groups messages into `{user, answer?, run?}`. A library Transcript would need either a pre-built turn model or per-part renderers.
4. **i18n is only partial.** `Labels` (`config.ts:154-167`) has 13 strings. Roughly 150 other strings are hardcoded in components (button titles, toasts, error titles, "Thought for Ns", etc.). There is no locale or plural machinery. A library should take a `messages` or `labels` map for every string.
5. **Colour tokens are CSS custom properties scoped under `.oa-root[data-theme=light|dark]`** (`styles.css:4-64`). All use oklch except `--on-accent: #fff` in light. Syntax colours are hardcoded oklch for a dark code panel in both themes (`styles.css:1153-1185`). Prefixes are `oa-`.
6. **Domain coupling is light.** Omnitech-specific parts are the `ProductAdapter` (proposal `describeProposal`, `applyProposal`, `revertProposal`), "Surfaces" (@-mentions of host UI regions), and the `proposePatch` and `searchEvidence` tool names. The generic rendering around them is portable.
7. **No branching tree UI.** Branching is a per-message version pager (`1 / 2`) driven by `message.siblings`. Selection calls `POST /threads/:id/branch`.

---

## 1. Repo map and conventions

| Area | Files |
|---|---|
| UI package | `packages/react/src/{Assistant.tsx 542, useAssistant.ts 552, config.ts 267, context.ts 101, turns.ts 147, relay.ts 92, browser.ts 262, dictation-key.ts 81, highlight.ts 50, icons.ts 151 (generated), index.ts 30, styles.css 2355}` |
| Components | `packages/react/src/components/{Composer 712, Conversation 787, Models 354, Proposal 306, Header 272, Settings 208, Sidebar 189, DataPrivacy 155, Markdown 146, Connectors 138, Personalisation 107, Shared 60, Icon 34}.tsx` |
| Contracts | `packages/contracts/src/{schemas.ts 814, ports.ts 207}` (zod) |
| Server | `packages/server/src/{app.ts 995, attachments, proposals, connectors, context-window, conversation, authority, executor 1012, relay}.ts` |
| Providers | `packages/providers/src/{sources.ts 365, openai.ts, anthropic.ts, lm-studio.ts, openai-sse.ts}` |
| SDK | `packages/sdk/src/index.ts` (`createAssistantClient`, `validateFiles`, `ATTACHMENT_TYPES`) |
| Reference host | `apps/playground/web/main.tsx` (304 lines), `server/{main,document}.ts` |
| Specs | `docs/superpowers/specs/2026-10-01-assistant-prototype-parity-design.md` (prototype-element → implementation table, build order) |

**Conventions**
- Flat `components/` of PascalCase `.tsx` files, one per feature area (not one per component).
- Hooks and utilities are lowercase `.ts` in `src/`.
- Relative imports carry the `.ts` or `.tsx` extension (`rewriteRelativeImportExtensions`, per `docs/2026-10-01-engineering-baseline.md`).
- Shared state goes through one React context (`context.ts`, `usePanel()`). Components read from the context rather than taking props, so nothing is library-ready as-is.
- CSS is a single `styles.css` with `oa-` class names, shipped as `@omnitech-assistant/react/styles.css`.
- Icons are a generated map of Material Symbols Rounded SVG paths (`icons.ts`, `scripts/generate-icons.mjs`). It has about 85 names plus `-fill` variants for thumb_up, thumb_down, play_arrow and push_pin. `Icon` (`C/Icon.tsx`) renders an inline `<svg viewBox="0 -960 960 960" aria-hidden>`.
- Biome lint with warnings as errors, and Lefthook hooks.
- Persisted per-viewer preferences live in `localStorage` under `omnitech-assistant:<key>` via `usePreference` (`browser.ts:7`): theme, mode, sendOnEnter, model, effort.
- Peer deps: react 18.3 or 19. Runtime deps: `react-markdown`, `remark-gfm`, `lowlight`, `diff`.

**Tests** (`packages/react/test/*.test.tsx`, vitest with `@vitest-environment jsdom`, `@testing-library/react`)
- They are integration-style. `startStack()` (`tests/fixtures/stack.ts`) boots a real Hono app, real disposable PostgreSQL, the real executor and queue, and scripts only the model's output (`stack.reply(...)`, scripted tool calls).
- The UI is mounted in `<StrictMode>` with `AssistantRoot` and a real `AssistantClient`.
- Assertions use roles and text (`getByRole("textbox", {name:"Message"})`, `getByTitle("Stop (Esc)")`) and class hooks (`.oa-acts`, `.oa-error`).
- Test names: `assistant` (18), `models` (3), `local-models` (3), `approvals` (2), `connectors` (1), `data` (3), `personalisation` (1), `sources` (1), `dictation-key` (4).
- Coverage by behaviour:
  - Empty state, starters, and auto-titling.
  - Regenerate versions, and edit as a branch.
  - Tool timeline, proposal review, apply, undo, reject, restore, and checklist partial apply.
  - Rename, pin, archive with undo, delete with undo, and search.
  - Slash commands, @ attach, and saved prompts.
  - Queued sends, and error with retry.
  - Feedback reasons.
  - Feature flags hiding controls.
  - Dictation key, with the cursor ending at the end of the draft.
  - Full-page toggle and the keyboard toggle.
  - Config rebuilt every render.
  - Model picker, effort, context ring and summarise.
  - Vision warning and Switch.
  - On-device model relay.
  - Approvals once, always, and deny.
  - MCP connector read-only versus approval-required tools.
  - Share link, activity log, export, retention, and delete-everything double click.
  - Personalisation and memory.
  - Citations, source card, and follow-ups.
- `dictation-key.test.tsx` is a pure hook test using `renderHook` and fake timers.
- For a UI library, expect presentational tests (Storybook or RTL with fixtures) rather than a full stack. The existing assertions are good acceptance cases to port.

---

## 2. Configuration surface (`config.ts`, `context.ts`)

### 2.1 `AssistantConfig` (`config.ts:169-205`)

| Key | Type / default | Meaning |
|---|---|---|
| `client` | `AssistantClient` (required) | All server I/O. Library-side, replace with callbacks and data props. |
| `origin` | `{workspaceId, artifactId, artifactRevision}` (required) | The host item the assistant works inside. |
| `product` | `{name, description?}` (required) | Name appears in "Add from {name}", "Applied to {name}", and the empty state. |
| `user?` | `{name, detail?, initials?}` | Sidebar footer avatar and name. Initials default to the first letters of the name (`Sidebar.tsx:35-42`). |
| `profileId?` | string | Host's default model. Resolution order: stored pick, then `profileId`, then server `defaultModel`, then first model (`Assistant.tsx:84-89`). |
| `features?` | `FeatureFlags` | See 2.2. |
| `variants?` | `{composer:"stacked"\|"pill", timeline:"summary"\|"rail", review:"diff"\|"checklist"}` | Defaults `stacked`, `summary`, `diff` (`DEFAULT_VARIANTS`). |
| `layout?` | `{mode?: "panel"\|"full", open?: boolean (default true), width?: number (default 440)}` | `mode` is also persisted. |
| `theme?` | `"light"\|"dark"` | When set it overrides the stored theme. Default is the stored value, then `"light"`. The design doc mentions `"system"` but the code has no such value. |
| `scope?` | `"item"\|"product"` | Conversations bound to the current item only, or across the product. `"product"` is honoured only if `host.onOpenBinding` exists (`Assistant.tsx:103`). |
| `starters?` | `Starter[] {icon?, title, subtitle?, prompt}` | Empty-state cards. Sends the prompt on click. |
| `prompts?` | `SavedPrompt[] {title, prompt}` | The saved-prompt popover. Inserts into the draft. |
| `commands?` | `SlashCommand[] {command, description, icon?, run(ctx)}` | `ctx = {setDraft, send, toast}`. |
| `surfaces?` | `Surface[]` or `(query) => Surface[] \| Promise<Surface[]>` | The "@" source. `Surface = {id, name, icon?, description?}`. |
| `tools?` | `Record<string, ToolLabel>` | `ToolLabel = {icon?, done, running, detail?(output,input)}`. Merged over `DEFAULT_TOOLS` (`searchEvidence`, `proposePatch`). Unknown tools fall back to `{icon:"extension", done:name, running:name}` (`Conversation.tsx:287`). |
| `shortcuts?` | `{toggle:"mod+j", search:"mod+k", newChat:"mod+shift+o", dictation:"AltRight"}` | The first three are `mod+shift+key` strings, with `mod` = ⌘ or Ctrl. `dictation` is a `KeyboardEvent.code`, and an empty string disables it. |
| `labels?` | `Partial<Labels>` | Defaults below. |
| `host?` | `HostHooks` | See 2.3. |
| `localModels?` | `{catalog, port, prepare?()}` | Models the browser runs itself (on-device WebGPU). Offered only when set. See section 14. |

`DEFAULT_LABELS` (`config.ts:154-167`):
- `assistant: "Assistant"`
- `conversations: "Conversations"`
- `newConversation: "New conversation"`
- `searchPlaceholder: "Search conversations"`
- `emptyTitle: "What are we working on?"`
- `localHint: "{model} runs locally — nothing leaves your machine"`
- `hostedHint: "Replies come from {model}"`
- `placeholderEmpty: "Ask anything  ·  / for commands  ·  @ to add context"`
- `placeholderReply: "Reply…  / for commands, @ to add context"`
- `replying: "Replying… keep typing to queue your next message · Esc to stop"`
- `nothingApplied: "Nothing has been applied yet"`
- `stopped: "Stopped. Nothing has been applied."`
- `settings: "Settings"`

### 2.2 Feature flags (`DEFAULT_FEATURES`, `config.ts:13-62`)

Every flag defaults to **true**. A group set to `false` disables the whole group. A group object disables only the flags it names. `resolveFeatures` is at `config.ts:73`.

| Group | Flags |
|---|---|
| `conversations` | `sidebar search pin rename archive delete share export` |
| `messages` | `copy editResend regenerate feedback readAloud followUps timeline thinking sources summaries usage` |
| `composer` | `attachments images mentions slashCommands savedPrompts modelPicker reasoningEffort contextMeter queue dictation promptHistory starters` |
| `review` | `proposals preview undo approvals` |
| `settings` | `general personalisation memory models connectors data` |
| `layout` | `fullPage close themeToggle shortcuts toasts` |

**Capability gating** (`can()` at `Assistant.tsx:123`). A flag also requires the server feature for these keys (`SERVER_REQUIREMENTS`, `config.ts:90-100`):

| Flag | Server feature |
|---|---|
| `conversations.search` | `search` |
| `conversations.pin` | `pin` |
| `conversations.rename` | `rename` |
| `conversations.archive` | `archive` |
| `conversations.delete` | `delete` |
| `messages.editResend` | `branches` |
| `messages.regenerate` | `branches` |
| `messages.feedback` | `feedback` |
| `composer.attachments` | `attachments` |

Other capability gates are inline:
- Images: `can(images) && caps.has("images")`.
- Dictation: `canDictate()`, which needs `SpeechRecognition` or `webkitSpeechRecognition`.
- Read aloud: `canSpeak()`, which needs `speechSynthesis`.
- Share: `caps.has("share") && host.shareUrl`.
- Model picker: more than 1 model, plus the flag.
- Context meter: `caps.has("context")` and an estimate present.
- Summarise: `caps.has("summaries") && threadId`.
- Partial apply and checklist: `caps.has("partialApply")`, more than 1 change, and `variants.review==="checklist"`.
- Undo: `features.review.undo && caps.has("undo")`.
- Restore proposal: `caps.has("restore")`.
- Personalisation tab: `caps.has("preferences")`. Memory section: `caps.has("memory")`.
- Connectors tab: `caps.has("connectors")`.
- Models tab: models loaded and `features.settings.models`.

`SERVER_FEATURES` (`schemas.ts:128-151`): search, rename, pin, archive, delete, branches, feedback, attachments, restore, undo, partialApply, models, images, context, summaries, approvals, preferences, memory, connectors, activity, export, share.

### 2.3 `HostHooks` (`config.ts:106-127`)

| Hook | Purpose |
|---|---|
| `prepareSend(): Promise<Origin>` | Save unsaved host state and return the origin the run uses. |
| `beforeApply(record)` | Awaited before apply. |
| `onApplied(receipt, origin)` | After apply. |
| `onPreview(record \| null)` | Show a proposal in the host without applying. Presence enables the "Preview in app" button (`Proposal.tsx:92`). |
| `onReverted(record)` | After undo. |
| `onContextChange(surfaces)` | The attached @ surfaces changed. |
| `onThemeChange`, `onOpenChange`, `onModeChange` | Notifications of the matching state changes. |
| `shareUrl(token)` | Required to offer "Share read-only link". |
| `onAddProvider()` | Offers "Add a cloud provider" and "Cloud providers → Add provider". |
| `onOpenBinding({workspaceId, artifactId})` | A conversation bound to another item was opened. |

### 2.4 `PanelContext` (`context.ts:31-70`)

This is the internal bus every component reads: `config, state, can, labels, variants, shortcuts, tools, theme/setTheme, mode/setMode, open/setOpen, historyOpen, settingsOpen, sendOnEnter, focus/setFocus, draft/setDraft, focusInput, searchRef, inputRef, copy, review{preview,setPreview,applied,apply,undo,canUndo}, models, model, setModel, effort, setEffort, modelFor, openSettings(tab)`.

- `Popover` union: `"slash"|"mention"|"plus"|"prompts"|"model"|"context"|null`. Only one is open at a time.
- `AssistantHost` (`context.ts:79-95`) is what the host page reads through `useAssistantHost()`: `open, setOpen, toggle, theme, setTheme, focus, shortcut, preview, applyPreview, discardPreview, applied, undoApplied`.

### 2.5 `useAssistant` state (`useAssistant.ts`)

It returns:
- Data: `capabilities`, `threads`, `archived`, `query`, `threadId`, `thread`, `messages`, `turns`, `before` (older cursor), `proposals`, `activeRun`, `live`, `queue`, `toast`, `error`, `summary`, `estimate`, `approvals`.
- Flags: `busy`, `waiting`.
- Actions: `send(text, files, focus)`, `cancel`, `regenerate(userMsgId)`, `editResend(msg, text)`, `selectVersion(id)`, `setFeedback`, `update/archive/unarchive/remove` (thread), `apply/revert/restore/reject` (proposal), `decide(approval, once|always|deny)`, `summarise`, `older`, `fullThread`, `open`, `newChat`, `notify`, `dismissToast`, `removeQueued`, `refreshEstimate`.

Behaviours:
- `busy` is true for submitting, or run status `queued`, `running` or `waiting` (`useAssistant.ts:75-79`).
- The SSE loop handles these events (`useAssistant.ts:125-176`):
  - `reasoning.delta`
  - `text.delta`
  - `tool.called` / `tool.result`, which refresh the thread and clear the live text
  - `approval.requested` / `approval.resolved`, which refresh the thread
  - terminal events, which refresh, clear `live`, and reload the list
- Toasts last 3800 ms (`useAssistant.ts:84`). A toast may carry an `undo` callback (archive, delete, apply).
- Title is auto-generated from the first 6 words of the first prompt (`titleFrom`, `turns.ts:128`).

---

## 3. Contract shapes the UI renders (`packages/contracts/src/schemas.ts`)

Source line numbers refer to the schemas file.

### 3.1 Messages and parts

`Message` (`messageSchema`):
```
{ id, threadId, role: user|assistant|system|tool,
  parts: MessagePart[1..256],
  createdAt, status: complete|partial,
  runId?, parentId?: id|null,
  siblings?: id[2..64],      // all versions in creation order (edits for user, regenerations for assistant)
  feedback?: {rating: up|down, reasons[], note?} }
```

`MessagePart` is the union of ModelPart and DisplayPart.

**ModelPart** (`schemas.ts:433-455`), sent to or from the model:
- `{type:"text", text}`
- `{type:"tool-call", id, name, input}`
- `{type:"tool-result", id, output}`
- `{type:"usage", usage}`
- `{type:"reasoning", text}`, the streaming thought
- `{type:"image", mediaType, data(base64)}`

**DisplayPart** (`displayPartSchema`, shown to people only):
- `{type:"attachment", kind: file|image|surface, id, name}`
- `{type:"reasoning", text, seconds}`. The stored thought carries its duration, which is what "Thought for 4s" is built from.
- `{type:"sources", items: SourceItem[1..256]}`
- `{type:"suggestions", items: string[1..6]}`, follow-up chips.

`SourceItem = {n (1..256), id, revision, title, meta?, quote(≤4000)}`.

`Usage` is a discriminated union on `status`: `known{input, output, total, cost}`, `partial{...}`, `unavailable{reason, cost}`. `cost` is `actual|estimated|unavailable`, with an amount and a 3-letter currency. The UI only shows `tokens = in + out` (`Conversation.tsx:663-668`).

### 3.2 Turns derived by `buildTurns` (`turns.ts:5-29`)

- `Step {id, name, input, output?, done, failed, group}`. `group` increments per assistant message that has tool calls, so calls in one group ran in parallel (the "parallel" badge). `failed` means the output has an `error` key.
- `Answer {first, final?, text, steps[], reasoning?{text,seconds}, sources[], suggestions[], usage?, partial, proposalIds[], seconds?}`.
  - `seconds` is the user-to-final timestamp delta.
  - `proposalIds` are mined from tool-result outputs shaped `{proposalId}`.
- `Turn {user, answer?, run?}`. `run` is the latest run for that user message.
- System messages are skipped. Tool-role messages only fill step outputs.

### 3.3 Run, events, approvals

- `Run {id, threadId, status, origin, userMessageId?, error?{code,message}, profileId?}`.
- `RunStatus`: `queued|running|waiting|completed|failed|cancelled|interrupted`.
- `Event` types: `run.queued/started/completed/failed/cancelled/interrupted`, `context.loaded` (carries `{omittedMessages, excludedPartialMessages, omittedToolGroups, summarized}`), `approval.requested/resolved`, `reasoning.delta`, `text.delta`, `usage.reported`, `tool.called`, `tool.result`, `proposal.created/applied/rejected/reverted/restored/conflicted`, `attachment.status`. Each has `{runId, sequence, type, payload}`.
- `Approval {id, runId, callId, tool, title, description?, tags[≤8], status: pending|once|always|denied}`.

### 3.4 Proposals

- `Proposal {id, origin, patch: Record<string,Json>, evidence[]}`.
- `ProposalRecord` (SDK, `proposalRecordSchema`): `{proposal, status, receipt?, changes?: ProposalChange[≤32]}`.
- `ProposalStatus`: `pending|applied|rejected|conflicted|reverted`.
- `ProposalChange {id, label, description?, icon?, language?, before, after}`. This is one product surface's before and after, and the diff source.
- `applyInput {surfaces?: id[1..32]}` for partial apply.
- `Receipt {proposalId, artifactRevision}`.

### 3.5 Other shapes

- `Thread {id, title, revision, createdAt, updatedAt, pinned, archived, binding?{workspaceId, artifactId}}`.
- `ThreadPage {thread, binding, messages[≤100], runs[], summary|null, approvals[], nextCursor|null, activeRun|null}`. `nextCursor` drives "Load earlier messages".
- `ThreadSummary {text, count, throughMessageId}`.
- `Attachment {id, threadId, name, mediaType, bytes(≤10485760), status: submitted|extracting|ready|failed, sourceId?, sha256?, error?}`. Media types are text/plain, text/markdown, application/pdf, and image/png|jpeg|webp|gif.
- `ModelInfo {id, name, shortName?, description?, tags[≤8], vision, reasoning, contextWindow?, local, provider?{name, endpoint?, local}, tools?, strengths?[≤6], parameters?}`.
- `ModelsResponse {models[≤64], defaultModel?, provider?}`.
- `ContextEstimate {window?, used, sections[≤8 {label, tokens}], summarized}`.
- `Effort = off|low|medium|high`.
- `Connector {id, name, url, enabled, status: connected|unreachable|off, tools?}`.
- `Preferences {instructions(≤4000), memoryEnabled, retention: forever|90d|30d}`.
- `Memory {id, text(≤500), createdAt}`.
- `Activity {at, kind: tool|approval|applied|reverted|rejected, summary, threadId, threadTitle}`.
- `SharedConversation {title, messages[{role: user|assistant, text}] ≤1000}`.
- `Feedback`: `rating: up|down|null`, `reasons[≤10]`, `note?`.
- `LIMITS` (`schemas.ts:3-17`): prompt 32000 chars, attachments 10, evidence text 100000, textDelta 16384.

---

## 4. Conversation rendering (`C/Conversation.tsx`)

### 4.1 Container (`Conversation`, lines 52-99)
- `.oa-scroll` > `.oa-column` with `role="log" aria-live="polite" aria-label="Conversation"`. Max width is 760 px (`styles.css:637`).
- **Scroll follow**: it pins to the bottom while within 200 px of it (`useLayoutEffect` plus `onScroll`). It stays put if the reader scrolled up. Opening another thread re-pins.
- **Load earlier**: a "Load earlier messages" button is shown when `state.before` is set. It prepends the older page, de-duplicated by id.
- **Empty**: when `turns.length === 0 && !busy` the `empty` node is shown (section 13).
- **Summary divider** (`SummaryDivider`, lines 27-50): after the turn that contains `summary.throughMessageId`, and only if it is not the last turn, it shows a rule with "N earlier message(s) summarised". It has an `aria-expanded` toggle that reveals the summary text plus "The full history is still stored — only the model sees this summary."

### 4.2 Turn (`TurnView`, 101-139)

Order within a turn: user message, then **decided** approvals, then the assistant message, then **pending** approvals, then the error card.

Derived states:
- `running = last && busy && !waiting`
- `waiting = last && state.waiting`
- `failed = no final answer && !running && run.status in {failed, interrupted}`
- `cancelled = !running && run.status === "cancelled"`

The assistant block shows when there is an answer, live text, running or waiting, and not failed.

### 4.3 User message (`UserMessage`, 141-247)
- Attachment chips (`.oa-chips`), one per `attachment` part, with icon `image|widgets|description` for kind image, surface, or file.
- `.oa-bubble` with the prompt text.
- **Edit mode**: a 3-row textarea (`aria-label="Edit message"`). Enter sends when `sendOnEnter` is on and the text is non-empty. Escape cancels. A hint reads "Sends as a new branch — the original is kept." There are Cancel and Send buttons. Send is disabled when the text is empty or `busy`.
- **Hover actions** (`.oa-user-acts`, always shown when there are siblings): a version pager plus Copy (`messages.copy`) plus Edit and resend (`messages.editResend`, disabled when busy).
- The edit sends `{prompt, parentId: original.parentId ?? null}`. This starts a sibling branch beside the original.

### 4.4 Version pager (`Versions`, 249-285)
- Previous and next icon buttons and a "i / n" count.
- Disabled while `busy` or at either end. It calls `state.selectVersion(siblingId)`, which hits `POST /v1/threads/:id/branch`.
- The same component is used for user edits and assistant regenerations.

### 4.5 Tool or step timeline (`Timeline`, 291-384)

Variant `summary` (default) shows a collapsible button:
- Running: spinner, then "{running label}…" or "{first} + N more…".
- Waiting for approval: "Waiting for your approval".
- Stopped with pending steps: "Stopped while working".
- Done: check icon, then "Used N tool(s) · X.Xs".

Expanding it lists rows. Each row has the tool icon, label (`running` or `done` from `ToolLabel`), a detail (`label.detail(output,input)`, or "…" while active), a "parallel" tag when the group has more than 1 step, and a spinner or check.

Variant `rail` shows a vertical dotted timeline with a connector line and a per-step dot (done, running, or empty). It is shown while working or when expanded.

Gating: `messages.timeline`. The default `ToolLabel`s cover `searchEvidence` ("Searched evidence", detail "N passage(s)" or "No matching passages") and `proposePatch` ("Drafted a change", detail "Waiting for your review" or "Refused — the model tried again").

### 4.6 Assistant message (`AssistantMessage`, 386-652)

In order:
1. Timeline.
2. **Thinking block** (`messages.thinking`):
   - While running with reasoning and no text yet: a spinner and "Thinking…".
   - After: a brain icon and "Thought for Ns" (`max(1, round(seconds))`).
   - Toggleable text via `aria-expanded`, shown in a muted block (`.oa-quiet`).
3. Markdown body with the streaming cursor (`.oa-cursor`) while running. Live text comes from `state.live.text`. After a tool call, live text resets (intermediate text belongs to the step).
4. "Stopped" banner when cancelled: `labels.stopped`, with a stop-circle icon.
5. **Sources** (shown when done): chips plus an expandable quote card (section 6).
6. **Proposal cards** (when not running).
7. **Action bar** (when done or stopped):
   - Copy.
   - Regenerate (disabled when busy).
   - Version pager if more than 1 sibling.
   - Thumbs up and thumbs down. These are `aria-pressed` and use the filled icon variants.
   - Read aloud toggles to stop-circle while speaking.
   - Meta text: `"{model shortName} · {N} tokens · local"`.
8. **Feedback panel**. Thumbs-down opens "What went wrong?" with toggle chips (Incorrect, Not what I asked, Too long, Ignored my evidence, Unsafe change; `FEEDBACK_REASONS`, line 12), then Cancel and Send feedback. Thumbs-up toasts "Thanks for the feedback". Sending feedback toasts "Feedback sent — thank you". Feedback writes are serialised through a promise queue (`useAssistant.ts:456-466`).
9. **Follow-up chips**: shown only on the last turn, when done and not busy. They send the suggestion as a message.

### 4.7 Approval card (`ApprovalCard`, 679-748)
- Shield badge, title, optional description, tags (the first tag is monospace).
- Pending: Deny, "Always allow in this chat", and "Allow once" (primary). They disable while a request is in flight.
- Resolved states: Allowed once, "Always allowed for {tool} in this conversation", and "Denied · nothing was run".
- It is a `section` with `aria-label="Approval needed"`. Gated by `review.approvals`.

### 4.8 Error card (`ErrorCard`, 750-787)
- `role="alert"`, icon, title, message, and a **Retry** button (`regenerate(userMsgId)`, re-runs from the same user message with no new prompt). It disables while busy.
- Text appended: "Your message is saved and nothing has been applied."
- Titles map by `run.error.code` (`ERROR_TITLES`, line 750):
  - `model-unavailable` → "Couldn't reach the model"
  - `model-timeout` → "The model took too long"
  - `model-busy` → "The model is busy"
  - `model-refused` → "This model isn't available"
  - `on-device-unavailable` → "The on-device model isn't running"
  - `output-truncated` → "The reply was cut off"
  - `worker-stopped` and `lease-expired` → "The reply was interrupted"
  - Anything else → "The reply didn't finish".
- The design doc lists "Switch model" on the error card, but it is not implemented in this file.

### 4.9 Other conversation behaviours
- **Queue** (composer, section 7.6): messages sent while busy are queued and flushed in order.
- **Regenerate**: `startRun({regenerate: userMessageId})` creates a sibling assistant branch.
- **Edit**: described in 4.3.
- **Read aloud** uses `speechSynthesis` (`browser.ts:120`) and `speakable()` strips code blocks ("(code omitted)"), citations, and markdown punctuation.
- **Shared view** (`C/Shared.tsx`): read-only transcript with `title` and `messages[{role,text}]`, a "This link isn't shared any more." empty state, and no actions.

---

## 5. Markdown, code blocks, highlighting, copy

`C/Markdown.tsx`, `highlight.ts`.
- `Markdown({text, sources[], onCite?, onCopy, children})` is `memo`'d. It uses `react-markdown` plus `remark-gfm`, so tables, task lists and strikethrough work.
- Headings h1-h6 all render as a styled `div.oa-h`, so there is no document outline.
- Links open in a new tab with `rel="noopener noreferrer"`.
- Inline code uses `code.inline`.
- `pre` renders `CodeBlock` with `{code, language, onCopy}`. The language comes from `language-xxx` on the `code` class.
- `CodeBlock` (`Markdown.tsx:40-78`) shows a header with the language (default "text"), a Copy button and a monospace `pre` with per-line `div`s, each `min-height:1.65em`. Tokens carry `hljs-*` classes.
- **Highlighting** (`highlight.ts`): `lowlight` with `common` grammars, aliases `ts, js, sh, py`. An unknown language uses `highlightAuto`. Failures fall back to plain lines. `highlightLines(code, lang) → Token[][]` is reused by the diff view.
- Colours are hardcoded in `styles.css:1153-1185` and are not themed per mode. The code panel is always dark (`--code-bg`, `--code-border`).
- **Citations** (`remarkCitations`, `Markdown.tsx:10-38`): `[n]` in text nodes (not code) is replaced with a `button.oa-cite`, but only if source `n` exists in `sources`. Click toggles the matching source card via `onCite`.
- The copy callback is `panel.copy`, which writes to the clipboard and toasts "Copied to clipboard" or "Copy isn't available here" (`Assistant.tsx:164-171`).
- The streaming cursor is a child slot (`children`) placed after the markdown.

---

## 6. Citations, source chips, sources panel

Shown only when `messages.sources` is on and `answer.sources.length > 0` and the message is `done` (`Conversation.tsx:477-514`).
- `.oa-source-chips`: one `button` per source with a number badge (`n`), title and optional meta. `aria-pressed` reflects the opened source.
- Clicking a chip or an inline `[n]` opens one `.oa-source-card` at a time (clicking again closes). The card has a description icon, bold title, optional meta, and a close icon button. The body is `<blockquote>“{quote}”</blockquote>`.
- Server side: `executor.ts:260` numbers evidence shown to the model. At `executor.ts:922-968` it cites only `[n]` numbers that the reply actually used, so an invented number cites nothing. A `sources` display part is stored on the reply. Titles come from `sourceTitle(evidence)` (`conversation.ts:407`) and quotes from `excerpt()`.
- Follow-up suggestions are generated by a short extra model call (`followUpRequest`, `parseFollowUps`), time-boxed (`executor.ts:103`).

---

## 7. Proposals (`C/Proposal.tsx`)

### 7.1 What they are
A proposal is a reviewable change the assistant drafts through the `proposePatch` tool. It carries a `patch` for host-defined "surfaces" (for example Notes, Code, Tests). The model never edits directly. Flow: propose, then the user reviews, then Apply (writes to the host through `ProductAdapter.applyProposal`), then optionally Undo.

Server logic is in `packages/server/src/proposals.ts`:
- `read` calls the host's `describeProposal` to produce `ProposalChange[]`. If that fails or is missing, the card falls back to showing raw patch JSON (`Proposal.tsx:189-193`).
- `apply` is transactional. A revision or origin conflict rolls back, marks the proposal `conflicted`, and returns a 409.
- Partial apply requires the adapter's `supportsPartialApply`.
- `revert` requires the adapter's `revertProposal`.
- Also `restore` (reject then pending) and `reject`.

### 7.2 Card layout (`ProposalCard`, 54-306)
- Header: badge icon (`difference`, or `checklist` in checklist mode), title "Proposed change" or "N proposed changes", subtitle `"N surface(s) · +A −R"` (or "Pick what to apply. You can undo afterwards." in checklist mode), and a status pill.
- Status pill (`PILLS`): pending "Not applied" (amber), preview "Previewing" (accent), applied "Applied" (green), rejected "Rejected" (muted), reverted "Rolled back" (muted), conflicted "Not applied" (red). The pill uses `style={{background, color}}` with token vars.

**Variant `diff`** (default):
- `role="tablist"` tabs per change. Each shows the label and `+n` and `−n` counts.
- A `role="tabpanel"` diff computed with the `diff` package's `diffLines`. It shows changed lines plus **1 line of context** each side, "⋯" gap rows, +/− signs, and syntax-highlighted tokens using `change.language`.

**Variant `checklist`** (needs `partialApply`, more than 1 change):
- Rows with a check toggle (`aria-pressed`, `aria-label=change.label`, disabled once not pending), an icon (`change.icon` or `widgets`), label, description, and +/- counts.
- All are selected by default. Unticked ids are tracked, so new surfaces default to selected.
- Apply label: "Apply both" (2), "Apply all", or "Apply N". Apply is disabled with zero selected.

Footer (`.oa-card-foot`): a note icon plus text per phase, and phase-dependent buttons:

| Phase | Note | Buttons |
|---|---|---|
| pending | `labels.nothingApplied` | Reject (or "Discard" in checklist), "Preview in app" (or "Preview") if `review.preview` and `host.onPreview`, Apply |
| preview | "Showing in {product} — not applied" | Stop preview, Apply |
| applied | "Applied to {product}" | Undo (if `canUndo`) |
| rejected | "Rejected — nothing changed" | "Restore proposal" (if `restore` cap) |
| reverted | "Rolled back — original restored" | Re-apply |
| conflicted | "Not applied — {product} changed since this was proposed" | none |

- It is a `section` with `aria-label="Proposed change"`. Buttons disable while `working`. Failures toast "That didn't work — nothing was changed" or the error message.
- Apply toasts "Applied to {names joined by ' and '}" with an **Undo** action when allowed (`Assistant.tsx:216-233`). Undo toasts "Rolled back — original restored".
- Preview state is held in the root (`review.preview`). The host page reads it via `useAssistantHost()` to render the changed content and banners (see playground `Host`, `main.tsx:140-190`).

---

## 8. Composer (`C/Composer.tsx`)

Props today: `{popover, setPopover, modelMenu?, modelButton?, contextMeter?, modelWarning?, onSummarise?}`. Everything else comes from context.

### 8.1 Layout variants (`variants.composer`)
- `stacked` (default): `.oa-box.stacked` with attachment chips, then the input, then a toolbar row: `+` button (outlined), model button, spacer, context meter, actions (mic and send).
- `pill`: chips above, then `.oa-box.pill` as a single row: `+`, input, context meter, actions. In this variant the model control moves to the Header (`Assistant.tsx:391-406`) as `.oa-model-pill`.
- Below the box is a hint line (`.oa-hint`). While streaming it shows `labels.replying`. Otherwise with a model it shows `localHint` or `hostedHint` with `{model}` substituted. Without a model it shows "⌘J to show or hide · / for commands · @ to add context".

### 8.2 Input
- `<textarea aria-label="Message" rows=1>`. It **auto-grows** up to 200 px (`onDraft`, lines 237-238, and `focusInput` in `Assistant.tsx:149-162`, which also puts the caret at the end).
- Placeholder: `placeholderEmpty` if there are no turns, else `placeholderReply`.
- **Send on Enter** (`sendOnEnter` preference, default true): Enter submits, Shift+Enter adds a newline. IME composition is respected (`!isComposing`).
- **ArrowUp on an empty draft** recalls the last prompt (`composer.promptHistory`).
- **Paste** of accepted file types attaches them. Images are included only when `images` is allowed.

### 8.3 Slash commands (`composer.slashCommands`)
- Trigger: draft matches `/^\/(\w*)$/`, so only when the whole draft is `/word`.
- Popover `role="listbox" aria-label="Commands"`, with a "Commands" label and a hint "↑↓ navigate · ⏎ select · esc close".
- Keys: ArrowUp, ArrowDown, Enter or Tab to choose, Escape to close. Hovering moves the highlight.
- Built-ins: `/new`, `/model` (only if there is a model menu), `/prompts` (only if prompts exist), `/summarise` (only if summarise is available), `/clear` (clears draft, files and focus). Then the host's `commands`.
- `export` is listed in the design doc but is not implemented as a slash command.
- Filtering is `command.startsWith(query)`. Choosing clears the draft and runs the command.

### 8.4 @ mentions or surfaces (`composer.mentions`, requires `config.surfaces`)
- Trigger: `/(?:^|\s)@([^\s@]*)$/`.
- Popover "Add from {product}", `role="listbox"`. It uses the same keyboard handling, and shows "Nothing matches" when empty.
- `surfaces` may be static or `(query) => Promise`. Results are filtered by name containment and exclude already attached surfaces.
- Picking one removes the `@query` from the draft and adds it to `panel.focus`. It renders as an attachment card labelled "From {product}". `host.onContextChange` fires.
- On send, `focus` goes as `focus: [{id, name}]` (max 16).

### 8.5 `+` menu (`popover==="plus"`)
Items, each with icon, label, description, and optional separator:
- "Upload a file" (Text, Markdown or PDF), when `attachments`.
- "Add an image" ("Or paste a screenshot"), when `images`.
- "Add from {product}", when `mentions` and `surfaces`.
- "Saved prompts", when `savedPrompts` and prompts exist.
- One row per **connected** connector: `Connector · N tools`, with a separator before the first. Clicking opens Settings on the connectors tab.

The button has `title="Add files, images or context"` and `aria-expanded`. Connectors are refetched whenever settings close.

### 8.6 Attachments
- Hidden file inputs: one for files (`text/plain, text/markdown, application/pdf`), one for images (png, jpeg, webp, gif). Images are enabled only when `can(images) && caps.has("images")`.
- **Limits** (SDK `validateFiles`, `sdk/src/index.ts:178`): at most 10 files, at most 10 MB (10485760 bytes) each, and the type must be in `ATTACHMENT_TYPES`. Failure toasts "Attach up to 10 text, Markdown, PDF or image files of 10 MB or less".
- Server limits: extraction timeout 10 s, 100000 characters of text, at most 2 concurrent extractions (503 `extraction-busy`), magic-byte validation for images and PDFs, and UTF-8 validation (`server/src/attachments.ts`).
- **Attachment cards** (`.oa-atts > .oa-att`): a thumbnail (an object-URL image preview for images, otherwise an icon), name, kind label ("File", "Image" or "From {product}"), and a Remove icon button. There is no status or progress. Max width is 220 px (`styles.css:1932`). Object URLs are created and revoked per `files` change.
- **Vision warning** (`blind`): an image is attached and `model.vision === false`. It shows an `<output class="oa-warn">`, "{model} can't see images. Switch to {seer}?" with a Switch button. Without a vision model it says "The image will be described as attached only."
- `modelWarning` is an extra slot above the box.

### 8.7 Dictation (`browser.ts:56-116`, `dictation-key.ts`)
- Web Speech API: `continuous=true`, `interimResults=true`, `lang=navigator.language`. The mic button is shown only when `dictation` is on and `canDictate()`.
- While active, the input is replaced by `.oa-dictation` (`aria-live="polite"`) with a pulsing record dot (stacked only), the live transcript (or "Listening…"), and a 20-bar animated waveform (`aria-hidden`; the waveform is CSS-only, not audio-driven). Actions become Cancel (abort) and Done (appends the words to the draft).
- Errors toast "Microphone access was denied" or "Dictation stopped unexpectedly". `aborted` and `no-speech` are ignored.
- **Key handling** (`useDictationKey`, `dictation-key.ts:8-73`): a key pressed alone (default `AltRight`, the config `shortcuts.dictation` code).
  - **Tap** toggles start and finish.
  - **Hold** for `holdMs` (default 500) starts push-to-talk, and release finishes it.
  - Any other key pressed while it is down sets `interrupted` and cancels the gesture, so Option chords and accented letters still type.
  - Window blur finishes a held dictation.
  - It listens on the capture phase at `window`. `describeDictationKey("AltRight")` gives "Right ⌥" (`dictation-key.ts:76`).
  - Tested in `dictation-key.test.tsx`.

### 8.8 Send, stop, queue
- Send button states (lines 388-391):
  - Idle and empty: disabled, `arrow_upward`.
  - Idle with draft: ready, `arrow_upward`, title "Send (Enter)".
  - Streaming with no draft: `stop`, "Stop (Esc)", and click cancels.
  - Streaming with a draft: `playlist_add`, "Queue message".
- `hasDraft` counts the text, files, and focus.
- **Queue** (`composer.queue`): while busy, sent messages are held in `state.queue {id, text, files, focus}` and shown as "Queued {text}" rows with a Remove button. They flush in order when the run ends (`useAssistant.ts:332-338`).
- `Esc` cancels the run when no popover, settings or history is open (`Assistant.tsx:281-286`).
- Clearing: after send, draft, files and focus are reset and the popover closes.
- Drafts are not persisted across reloads.

### 8.9 Model picker inline
`modelButton` (stacked variant) shows `modelLabel(model, effort)`, which is "ShortName · Effort" for reasoning models and just the name otherwise, plus an `expand_more` icon and `aria-expanded`. It opens `ModelMenu` (section 10). It is shown only when `modelPicker` is enabled and there are more than 1 model.

### 8.10 Context meter
Section 11.

---

## 9. Keyboard shortcuts

| Shortcut | Action | Source |
|---|---|---|
| `mod+j` (configurable `toggle`) | Show or hide the assistant | `Assistant.tsx:274` |
| `mod+k` (`search`) | Open the sidebar and focus search (needs `conversations.sidebar`) | `:269` |
| `mod+shift+o` (`newChat`) | New chat and focus the input | `:277` |
| `Esc` | Close settings, else popover, else stop the reply, else close history | `:281` |
| `Enter` / `Shift+Enter` | Send or newline (toggleable preference) | `Composer.tsx:262` |
| `↑` in an empty box | Recall the last prompt | `Composer.tsx:273` |
| `/` and `@` | Open command or mention popovers; ↑↓ Enter Tab Esc navigate | `Composer.tsx:240-261` |
| `AltRight` tap or hold | Dictation | `dictation-key.ts` |
| In the edit box: `Enter` sends, `Esc` cancels | | `Conversation.tsx:178` |
| Rename input: `Enter` commit, `Esc` cancel | | `Header.tsx:180` |

The shortcut matcher is `matches(event, "mod+shift+o")`, and `describeShortcut` renders ⌘, ⇧, ⌥ on Mac. The General settings tab lists the active shortcuts (`Settings.tsx:53-77`).

---

## 10. Models and provider selection (`C/Models.tsx`)

- `ModelMenu({models, selected, effort, onPick, onEffort, onAddProvider?})` is a `role="dialog" aria-label="Model"` popover.
  - It groups **consecutive** models by `model.provider ?? models.provider`. Group headers show a green dot, "Local · " prefix, the provider name, and the endpoint in monospace.
  - `ModelRow`: name and tag chips, capability line (`capabilitiesOf`: "262k context · tools · vision · reasoning · 30B"), "Good for {strengths}", and description. A check icon marks the selection. `aria-pressed` and `title=description` are set.
  - **Reasoning effort**: a `fieldset.oa-segmented` with Off, Low, Medium, High (`composer.reasoningEffort`). The note changes: "Higher effort is slower but more careful." versus "{model} doesn't reason step by step — effort is ignored."
  - "Add a cloud provider (optional)" shows when `host.onAddProvider` is set. It opens the Models settings tab.
  - Picking a model closes the menu. Effort stays open.
- Persistence: `model` and `effort` are stored in `usePreference`. The effective effort is passed to a run only if `model.reasoning && composer.reasoningEffort`.
- `ModelsSettings` (settings tab): endpoint field (read-only) with "Connected · N model(s)", help text for the local endpoint, the "Available models" list, and a Cloud providers row with an "Add provider" button.
- Server model plumbing (`providers/src/sources.ts`):
  - OpenRouter and LM Studio sources, profile prefixes `openrouter/` and `lm-studio/`, and a cached listing.
  - `STRENGTHS` regexes derive "Good for ..." (coding, agents, research, reading documents, speed, multilingual, medicine, plus images and long documents).
  - A `minContextTokens` filter.
- Reasoning: OpenAI and LM Studio `reasoning_content` or `reasoning`, and Anthropic thinking, are mapped to `reasoning` parts. Images are sent beside the text (test: `providers/src/reasoning-images.test.ts`).

---

## 11. Context window meter and compaction (`ContextMeter`, `Models.tsx:182-274`; server `context-window.ts`)

- A ring SVG in a round button. Percent is `min(100, round(used/window*100))`. The stroke colour is accent, then amber above 60%, then red above 80%. With no `window` the ring is empty and the title reads "About 1.2k tokens in context". With a window the title reads "Context N% used".
- Popover `role="dialog" aria-label="Context window"` showing the header and percent, a bar, "About 3.1k of 262k tokens", rows per `sections[]` (Instructions & memory, Workspace, Conversation; values in "k"), and the note "When it fills up, older turns are summarised — never silently dropped." A **Summarise now** button appears if `onSummarise` is provided.
- The estimate is fetched whenever the thread, message count or model changes, and not while busy (`Assistant.tsx:197-202`). It is hidden if the capability is missing or the fetch fails.
- Server: tokens are estimated as chars/4 (`context-window.ts:11`). `summariseNow` folds everything except the last 2 messages into the summary and returns `{count}`. Toast: "{count} earlier messages summarised — full history kept".
- `context.loaded` events report omitted and excluded messages and tool groups. The UI does not currently surface those, only the summary divider.

---

## 12. Sidebar, history, header

### 12.1 Sidebar (`C/Sidebar.tsx`)
- Props: `docked` (full-page mode docks it; panel mode overlays it, closable).
- `<nav aria-label="Conversations">`.
- Header: title, "New chat (⌘⇧O)" icon, and a Close icon in overlay mode. In archived view the title is "Archived" and the action is Back.
- Search (`conversations.search`): `label.oa-search` with a search icon, input and a ⌘K hint. It is debounced 200 ms through `refreshList` (`useAssistant.ts:251`) and matches titles and message text server-side.
- Groups (`dateGroup`, `turns.ts:139`): Pinned, Today, Previous 7 days, Previous 30 days, Older. They are based on `updatedAt` and day boundaries, and the pin group applies only when `pin` is on.
- Row: `aria-current` for the open thread, title, and hover actions. Actions are Pin or Unpin (the pin icon is filled when pinned), and Delete (`.del`) in the normal view, or Restore (unarchive) in the archived view.
- Delete and Archive show a toast with Undo. Delete is soft, with `POST /threads/:id/restore`.
- Empty states: "No conversations match “q”", "No archived conversations", "No conversations yet".
- "Archived · N" button (`conversations.archive`).
- Footer (`.oa-user`): avatar initials, name and detail from `config.user`, and a Settings gear. It is shown if `user` is set or `settings.general` is on.
- Opening a thread in overlay mode closes the overlay. If the thread's binding differs from the current origin, `host.onOpenBinding` fires.

### 12.2 Header (`C/Header.tsx`)
- Left: History button (panel mode and `sidebar`), then the title button. The title shows the thread title or `labels.newConversation`, with a chevron if the menu has items.
- Inline **rename**: an input (`maxLength 256`, select-all on open). Enter or blur commits, Esc cancels.
- Conversation menu (`role="menu"`, closes on outside mousedown). Items are gated:
  - Rename
  - Pin or Unpin
  - "Share read-only link" (needs `share` cap and `host.shareUrl`; creates a token, copies the URL, toasts "Read-only link copied")
  - Export as Markdown, PDF and JSON (client-side, using `fullThread()` for all pages; PDF opens the print dialog on a hidden iframe)
  - Archive
  - Delete (danger style)
  - Separators are computed per item.
- Right: `modelControl` slot (pill variant), New chat (panel mode), Expand or Back to side panel (`layout.fullPage`), Settings (panel mode; in full mode the settings gear lives in the sidebar), Close (panel mode, `layout.close`, title shows the toggle shortcut).
- Export formats (`browser.ts:197-262`): the "readable" filter keeps user messages and complete assistant messages without tool calls. Markdown has `## You` and `## Assistant` sections. JSON dumps `{thread, messages}`. The file name is slugified from the thread title.

### 12.3 Layout (`Assistant.tsx:378-537`)
- `AssistantRoot({config, children})` renders `.oa-root[data-theme]` containing an optional `.oa-host` (children) and the panel `<section class="oa-panel panel|full" aria-label="Assistant">`. The width is `flex: 0 0 {width}px` (default 440) in panel mode, and fills the space in full mode (full mode hides the host children while open).
- `AssistantPanel` is the standalone variant (no host).
- A toast (`<output class="oa-toast">`) is rendered at root, with an optional Undo button (gated by `layout.toasts`).

---

## 13. Empty state and starters (`Assistant.tsx:354-377`)
- `.oa-empty` shows an `h2` with `labels.emptyTitle`, an optional `product.description`, and (when `composer.starters` is on and starters exist) `.oa-starters` with one `.oa-starter` button per starter: icon (default `auto_awesome`), title, optional subtitle. Click sends the starter's prompt immediately.
- It is shown when there are no turns and the assistant is not busy.
- The empty state is passed to `Conversation` as the `empty` node. This is already a slot pattern.

---

## 14. Settings, connectors, privacy, personalisation

### 14.1 Settings shell (`C/Settings.tsx`)
- A modal `div.oa-modal` (backdrop mousedown closes) containing `role="dialog" aria-modal="true" aria-label=labels.settings`. A left vertical `tablist`, and a body `tabpanel` with a header and a Close button. It supports `initialTab`, and tabs are `SettingsTab {id, label, icon, render()}`.
- `Toggle` (`button aria-pressed aria-label`) and `Setting {title, description, children, tone: boxed|danger}` are the reusable atoms. Note there is no focus trap and no focus return on close, and Escape is handled by the global key handler.
- Tabs and gating:
  - **General** (`settings.general`): Theme segmented Light or Dark (`layout.themeToggle`, with the description "Applies to the assistant and {product}"), "Send with Enter" toggle, and a keyboard-shortcut list (`layout.shortcuts`).
  - **Personalisation** (`settings.personalisation`, `preferences` cap).
  - **Data & privacy** (`settings.data`).
  - **Connectors** (`settings.connectors`, `connectors` cap).
  - **Models** (`settings.models`).

### 14.2 Personalisation (`C/Personalisation.tsx`)
- "Custom instructions": textarea, `maxLength 4000`, **autosaved 600 ms** after typing stops. The description is "Added to every conversation. Keep it short."
- "Memory" (needs `settings.memory` and the `memory` cap): a Toggle, plus a list of remembered facts, each with a Forget icon button. The empty state reads "No memories yet. Say “remember that…” in any chat." Server-side is the `remember` tool.
- Loading state shows "Loading…". Errors toast per action.

### 14.3 Data and privacy (`C/DataPrivacy.tsx`)
- "Keep conversations" segmented: Forever, 90 days, 30 days.
- "Activity log": a View or Hide button that loads `Activity[]`. It renders a scroll list (max 220 px) with summary, thread title and a locale date, and the empty row "Nothing yet."
- "Export all data": downloads `assistant-export.json`.
- "Delete everything" (danger tone): **two-click confirm**. The first click changes the copy to "This can't be undone. Click again to confirm." and the label to "Yes, delete all". Then it resets the chat and reloads the list. There is no auto-reset of the confirm state.

### 14.4 Connectors (`C/Connectors.tsx`)
- Intro: "Connect tools through the Model Context Protocol. The assistant asks before using any tool that changes something."
- List rows: a hub icon tile, name, detail (`connectorDetail`: "Off", "Not reachable", or "N tool(s) · connected"), a Remove icon button and a Toggle.
- Add form: `input type=url` (`aria-label="MCP server address"`, placeholder `https://your-server.example/mcp`) plus "Add server". Toasts on failure or when unreachable.
- States: "Checking connectors…" (loading), "No connectors yet." (empty).
- Server (`server/src/connectors.ts`): URLs are checked by `ConnectorPolicy.allow(url, scope)`, and a rejection returns `connector-not-allowed`. Tools with `readOnlyHint === true` run freely and all others need approval.
- There is no OAuth, no per-connector auth state, and no scopes UI. A real "connected accounts" component would be new work.

### 14.5 On-device models and relay (`relay.ts`, `Assistant.tsx:90-115`)
- `config.localModels = {catalog, port, prepare?}`. Models tagged `on-device` are listed by the server but are filtered out of the picker unless `localModels` is set.
- When the selected model is on-device, `prepareSend` runs `localModels.prepare()` first (for example a WebGPU model download) and a failure surfaces like any send failure.
- While a reply is in progress (`busy && runsHere`), `useLocalRelay` loops: `client.relay.claim(profiles)`, runs `port.stream(scope, input)` in the browser, batches parts (every 100 ms or 32 parts) to `client.relay.send(id, {parts})`, then `{done:true}` or `{error}` (the message is capped at 500 characters). A 250 ms pause when nothing is claimed.
- This is **run resumption and relay**, not turn resumption. Turn resumption is the SSE `client.events(runId)` stream with sequence cursors (SDK `readEvents`). On opening a thread with `page.activeRun`, `open()` re-subscribes (`useAssistant.ts:203`).

---

## 15. Theming, icons, i18n, accessibility

**Tokens** (`styles.css:4-64`), light and dark each define:
- Surfaces: `--host-bg --host-surface --bg --sidebar --surface --subtle --hover --user-bubble`
- Lines: `--border --border-soft --border-strong`
- Text: `--text --muted --faint`
- Accent: `--accent --accent-soft --accent-ink --on-accent`
- Status: `--green --green-soft --red --red-soft --amber --amber-soft`
- Code: `--code-bg --code-border`
- Shadows: `--shadow --pop-shadow`
- `color-scheme`

Light uses hue 255, dark uses hue 260. The accent is `oklch(0.55 0.19 258)` in light and `oklch(0.7 0.14 258)` in dark. Fonts are `--oa-font` (Geist) and `--oa-mono` (Geist Mono) with fallbacks. Base size is 14 px, line-height 1.5. Keyframes: `oa-spin`, `oa-wave`, `oa-blink`, `oa-fade-up`. `@media (prefers-reduced-motion: reduce)` disables all animation and transitions (`styles.css:2345`). Theme switching sets `data-theme` on `.oa-root` (not `prefers-color-scheme`), and the host is told via `onThemeChange` or `useAssistantHost().theme`.

**Common UI classes to mine for library primitives**: `.oa-icon-btn` (+ `sm|xs|nav|on`), `.oa-btn` (+ `primary|danger|dark`), `.oa-round` (composer round buttons), `.oa-segmented` (+ `fill`), `.oa-toggle`, `.oa-menu/.oa-menu-item/.oa-sep`, `.oa-pop` (popover; `narrow|right|model`), `.oa-pill-tag`, `.oa-list/.oa-list-row/.oa-list-empty`, `.oa-field/.oa-textarea`, `.oa-quiet`, `.oa-toast`, `.oa-spinner`.

**Icons**: Material Symbols Rounded paths. The `IconName` union is exported, and hosts pass names (`Starter.icon`, `Surface.icon`, `SlashCommand.icon`, `ToolLabel.icon`, `ProposalChange.icon` as a free string cast to `IconName`). A library should accept `ReactNode` icons instead.

**i18n**: only the 13 `labels`. There are many inline English strings, plus a dozen toast messages in `useAssistant` and `Assistant`. Dates use `toLocaleString()` and numbers use `toLocaleString()`. There is no RTL handling. Plurals are hand-coded in places ("1 tool" versus "2 tools").

**Accessibility observed**
- Roles: `log` plus `aria-live=polite` on the conversation, `listbox` and `option` with `aria-selected` for slash and mention lists, `menu` and `menuitem`, `dialog` for the model and context popovers, `tablist` and `tab` and `tabpanel` for the diff tabs and settings, `alert` on the error card, `<output>` for toasts and warnings, `aria-pressed` on toggles, feedback, chips and source chips, `aria-expanded` on disclosures, and `aria-current` on the active thread.
- Gaps:
  - The popovers do not manage focus; focus stays in the textarea, with arrow-key roving only for the slash and mention lists.
  - The settings modal has no focus trap.
  - Diff tabs lack arrow-key navigation.
  - The waveform is correctly `aria-hidden`.
  - Disabled states use native `disabled`.
  - Icons are `aria-hidden`, and every icon button has a `title`, but only some have `aria-label`.

---

## 16. Domain-specific versus generic

**Keep in the app (Omnitech coupling):**
- `ProductAdapter` (describeProposal, apply, revert), `origin` (workspace, artifact, revision), the "Surfaces" concept and "Add from {product}", `prepareSend` and `useAssistantHost` preview and apply banners, `proposePatch` and `searchEvidence` tool labels (`DEFAULT_TOOLS`), `FEEDBACK_REASONS` ("Ignored my evidence", "Unsafe change"), error-code to title mapping, `useAssistant` and `AssistantClient`, relay and local models, and server-derived "Good for" strengths.
- Apply, undo and share toasts, and the `Labels` text that mentions the workspace.

**Generic and worth moving to a library:**
- Transcript turn and part rendering, the thinking block, step timeline (summary and rail), approval card, error card with retry, version pager, edit-and-resend editor, feedback chips panel, follow-up chips, source chips with quote card, citation pills, Markdown with CodeBlock and highlight, the diff review card (generic `{label, before, after, language}` changes), the composer with its popovers (slash, mention, plus, prompts), attachment cards, queue rows, dictation bar and key hook, send or stop button, context ring and breakdown, model picker and effort segmented, sidebar list with date groups and hover actions, header title with a rename and menu, settings modal with tabs, toggle and `Setting` rows, toast with undo, empty state with starters, and the summary divider.

---

## 17. Mapping to library components (priority P1 > P2 > P3)

Existing library pieces assumed: Panel, Transcript, Input (+actions slot), IconButton, Button, SplitButton, ActionMenu, Toolbar, Steps, Segmented, Tag, Empty, Progress, Divider, Popover, Popconfirm, Tooltip.

| # | Feature | Proposed library component or variation | Config props (data in, callbacks in, nodes as slots) | Pri |
|---|---|---|---|---|
| 1 | Turn list container (log, follow-bottom, load earlier, empty slot) | `Transcript` variation `conversation` | `turns`, `renderTurn`, `onLoadEarlier`, `hasEarlier`, `empty` node, `stickToBottomThreshold=200`, `ariaLabel` | P1 |
| 2 | User bubble with attachment chips | `Transcript` speech bubble `role="user"` | `text`, `attachments[{kind,name,icon?}]`, `actions` slot, `versions` | P1 |
| 3 | Edit and resend (inline editor) | `Transcript` message `editable` | `editing`, `value`, `onSubmit`, `onCancel`, `hint`, `submitOnEnter`, `disabled` | P1 |
| 4 | Version pager `1 / 2` | New `VersionPager` (small) or an `IconButton` pair inside `Transcript` actions | `index`, `count`, `onMove(step)`, `disabled`, labels | P2 |
| 5 | Assistant message with streaming cursor | `Transcript` message `role="assistant"` | `content` (markdown string or node), `streaming`, `cursor` node, `status: running\|stopped\|error` | P1 |
| 6 | Markdown body | `Markdown` renderer (or `Transcript` `renderMarkdown` slot) | `text`, `citations: number[]`, `onCite(n)`, `onCopy`, `components` overrides, `renderCode` | P1 |
| 7 | Code block with header and copy | `Transcript` code block (uses the existing `renderCode` slot) | `code`, `language`, `onCopy`, `highlight(code,lang)→Token[][]` slot | P1 |
| 8 | Syntax highlighting | A pluggable `highlighter` function prop (lowlight adapter shipped as an optional entry) | `highlightLines(code, lang)` | P2 |
| 9 | Thinking or reasoning block | `Steps` or new `Disclosure` variation `thinking` | `streaming`, `seconds`, `text`, `labelStreaming`, `labelDone(seconds)` | P1 |
| 10 | Tool or step timeline (summary list and rail) | `Steps` (variants `summary`, `rail`) | `steps[{id,icon,label,detail,state: pending\|running\|done\|failed,parallel}]`, `variant`, `summaryLabel`, `defaultOpen`, `renderIcon` | P1 |
| 11 | Approval request card | `ApprovalCard` (compose Panel, Tag, Button) | `title`, `description`, `tags`, `status`, `onDecide(decision)`, `labels`, `busy` | P2 |
| 12 | Error card with retry | `Transcript` event bubble `tone="danger"` | `title`, `message`, `onRetry`, `retryDisabled`, `extraActions` | P1 |
| 13 | "Stopped" banner | `Transcript` event bubble | `text`, `icon` | P3 |
| 14 | Message action bar (copy, regenerate, thumbs, read aloud, meta) | `Toolbar` of `IconButton`s inside `Transcript` actions | `actions[{key,icon,label,onClick,pressed,disabled}]`, `meta` text | P1 |
| 15 | Feedback reasons panel | `FeedbackPanel` (Panel + Tag toggle chips + Buttons) | `reasons[]`, `selected[]`, `onToggle`, `onSubmit`, `onCancel`, `title` | P2 |
| 16 | Follow-up chips | `Suggestions` (list of Tags or buttons) | `items[]`, `onSelect`, `icon` | P1 |
| 17 | Source chips and quote card | `Sources` (chips plus card) | `items[{n,title,meta,quote}]`, `openN`, `onToggle`, `renderCard` | P1 |
| 18 | Citation pill | Part of the Markdown renderer | `citations`, `onCite`, `renderCite` | P1 |
| 19 | Summary divider ("N earlier messages summarised") | `Divider` with a disclosure variation | `count`, `text`, `defaultOpen`, labels | P2 |
| 20 | Proposal diff card (tabs, +/− counts, status pill, footer actions) | `DiffReview` (Panel, Segmented or tabs, Tag, Button) | `changes[{id,label,description?,icon?,language?,before,after}]`, `status`, `previewing`, `selectable`, `selected`, `onSelect`, `actions[{key,label,primary,disabled}]`, `labels`, `contextLines=1`, `highlighter`, `variant: diff\|checklist` | P1 |
| 21 | Checklist variant of proposals | `DiffReview` `variant="checklist"` | as above, plus `applyLabel(selected,total)` | P2 |
| 22 | Composer (stacked and pill) | `Input` composer variation | `value`, `onChange`, `onSubmit`, `onStop`, `streaming`, `placeholder`, `sendOnEnter`, `maxHeight=200`, `variant: stacked\|pill`, slots `leading`, `toolbar`, `trailing`, `attachments`, `above`, `hint` | P1 |
| 23 | Send, stop and queue button states | `Input` `actions` slot (a `SendButton` helper) | `state: idle\|ready\|streaming\|queue`, `onClick`, titles | P1 |
| 24 | Slash commands | `CommandPopover` using Popover and a listbox | `items[{id,label,description,icon}]`, `query`, `activeIndex`, `onSelect`, `trigger: "/"`, `hint` | P1 |
| 25 | @ mentions | Same component with trigger `@` | `source(query)`, `onPick`, `emptyText` | P2 |
| 26 | `+` menu | `ActionMenu` | `items[{icon,label,description,onClick,separated}]` | P1 |
| 27 | Saved prompts popover | `ActionMenu` or `CommandPopover` | `items[{title,prompt}]`, `onPick` | P3 |
| 28 | Attachment cards | `AttachmentCard` or `FileChip` (IconButton plus Progress) | `name`, `kind`, `previewUrl`, `status: ready\|uploading\|extracting\|failed`, `progress?`, `error?`, `onRemove`, `label` | P1 |
| 29 | File picker, paste, **drag-drop** (missing today) | `Input` attachments behaviour | `accept[]`, `maxFiles=10`, `maxBytes`, `onFiles`, `onReject(reason)`, `dropzone` | P1 |
| 30 | Queued messages rows | `QueuedList` (compose list rows and IconButton) | `items[{id,text}]`, `onRemove`, `label` | P2 |
| 31 | Vision or capability warning | `Callout` or inline Alert (reuse Tag or Panel) | `message`, `action{label,onClick}`, `tone="warn"` | P3 |
| 32 | Dictation bar (live transcript, waveform) | `DictationBar` replacing the input | `active`, `text`, `placeholder="Listening…"`, `onCancel`, `onDone`, `waveform` node | P2 |
| 33 | Dictation key hook | `useHoldToTalk` utility | `code`, `holdMs=500`, `enabled`, `active`, `onStart`, `onFinish` | P2 |
| 34 | Model picker (popover with groups, tags, caps) | `ModelPicker` (Popover, Segmented for effort) | `models[{id,name,tags,description,caps,strengths,provider,local}]`, `selectedId`, `onPick`, `effort`, `onEffort`, `showEffort`, `onAddProvider` | P1 |
| 35 | Model chip (trigger) | `Button` or `SplitButton` variation | `label`, `onClick`, `expanded` | P1 |
| 36 | Reasoning effort | `Segmented` | `options`, `value`, `onChange`, `note` | P1 |
| 37 | Context window meter | `ContextMeter` (ring plus Popover plus Progress) | `used`, `window?`, `sections[{label,tokens}]`, `thresholds{warn:60,danger:80}`, `onSummarise?`, labels | P1 |
| 38 | Sidebar conversation list | `ConversationList` (Panel, list rows, ActionMenu) | `groups[{label,items[{id,title,pinned,active}]}]`, `search`, `onSearch`, `onOpen`, `rowActions[...]`, `empty`, `footer` slot, `archivedCount`, `onShowArchived` | P1 |
| 39 | Date grouping helper | Pure util `groupByRecency` | `now`, `pinned` | P3 |
| 40 | Conversation header (title, rename, menu) | `Toolbar` plus editable title | `title`, `onRename`, `menuItems`, `leading`, `trailing` slots, `editable` | P1 |
| 41 | Conversation menu (rename, pin, share, export, archive, delete) | `ActionMenu` with danger and separators | `items[{icon,label,onClick,danger,separated}]` | P1 |
| 42 | Empty state with starters | `Empty` variation `starters` | `title`, `description`, `starters[{icon,title,subtitle,prompt}]`, `onStart(prompt)` | P1 |
| 43 | Settings modal with tabs | `SettingsDialog` (Panel/Modal plus vertical tabs) | `tabs[{id,label,icon,render}]`, `activeTab`, `onTab`, `onClose`, `title` | P1 |
| 44 | Setting row and toggle | `SettingRow` plus `Switch` | `title`, `description`, `tone`, `children` | P1 |
| 45 | Keyboard shortcut list | `ShortcutList` | `items[{label,keys}]`, `describe(shortcut)` util | P3 |
| 46 | Personalisation (instructions, memory list) | `PreferencesForm` or compose `SettingRow` and `Input` | `value`, `onChange` (debounced), `maxLength`, `memories[]`, `onForget`, `memoryEnabled`, `onToggleMemory`, `empty` | P3 |
| 47 | Data and privacy (retention segmented, activity log, export, danger delete) | Compose `Segmented` and `Popconfirm` | `retention`, `onRetention`, `activity[]`, `onExport`, `onDeleteAll` (replace two-click with `Popconfirm`) | P3 |
| 48 | Connectors list | `IntegrationList` (list rows, Switch, IconButton, add form) | `items[{id,name,detail,status,enabled}]`, `onToggle`, `onRemove`, `onAdd(url)`, `loading`, `empty`; later an OAuth variation (`connectAction`, `account`) | P3 |
| 49 | Toast with undo | `Toast` or `Notifier` | `text`, `action{label,onClick}`, `duration=3800`, `placement` | P2 |
| 50 | Panel layout (side panel and full page) | `Panel` variation `assistant` | `mode: panel\|full`, `width=440`, `open`, `onOpenChange`, `sidebar` slot, `header`, `footer` | P2 |
| 51 | Theme tokens | Token file with the same CSS var names (`--bg --text --accent --green --red --amber --code-bg ...`) | `data-theme`; keep the oklch values | P1 |
| 52 | Icon set | Replace `IconName` with a `ReactNode` icon prop; the generated Material path map becomes optional | `renderIcon(name)` | P1 |
| 53 | Shared (read-only) transcript | `Transcript` `readOnly` | `title`, `messages[{role,text}]`, `missing` | P3 |
| 54 | Read-aloud and clipboard helpers | Utilities `useSpeech`, `copyText`, `speakable` | none | P3 |
| 55 | Export helpers (markdown, json, print) | Utilities | `toMarkdown`, `toJson`, `download`, `printConversation` | P3 |
| 56 | Hotkeys | `useHotkeys(shortcuts)` plus `describeShortcut` | `{toggle,search,newChat}` strings | P3 |
| 57 | Relay or local model running | **Stay in the app** | not a UI concern | n/a |
| 58 | Proposal logic, approvals logic, SDK, `useAssistant` | **Stay in the app** (an adapter maps data to the library props) | n/a | n/a |

### Suggested build order
1. **P1 core:** Transcript turn rendering with Markdown and code, composer with send, stop and attachments, `Steps` with summary and rail, `DiffReview`, `Sources`, `Suggestions`, `ModelPicker`, `ContextMeter`, `ConversationList`, header with menu, `Empty` starters, `SettingsDialog`, tokens and icons.
2. **P2:** version pager, approvals, feedback, dictation bar and hook, mentions, queue, toast, summary divider, panel modes.
3. **P3:** personalisation, data and privacy, connectors, shortcut list, read-only transcript, helper utilities.

### Things the library should add that the app lacks
- Drag-and-drop with a drop overlay.
- Per-file upload status and progress, since the contract has `AttachmentStatus`.
- A focus trap and return in dialogs, and arrow-key navigation in tabs and popovers.
- A fully labelled `messages` map for every string.
- A `prefers-color-scheme` option, since `theme: "system"` is in the design doc but not implemented.
- A "Switch model" action on the error card, which the parity doc lists but the code does not provide.