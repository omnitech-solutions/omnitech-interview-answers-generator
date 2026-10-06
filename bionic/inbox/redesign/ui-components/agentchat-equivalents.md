# Chat features we have not covered yet: equivalents from the Legion repos (2026-10-06)

Sources surveyed (read-only): `~/dev/mjsikorsky/legion-os-surveys` (its chat frontend is a vendored copy of the plugin, plus a SurveyJS respondent and a shadcn operator set) and `~/dev/mjsikorsky/legion-os-agentchat-plugin` (the plugin itself; its survey is tracked separately and any divergences are added below when it lands). Key paths in the surveys repo: `adapter/src/app/agentchat/vendor/features/commander-chatz/ui/{ChatPanel,CommandInput,attachments,widgets}`, `hooks/{useAttachments,useFileDrop,useDictation,useQueueEvents}.ts`, `model/ui-primitives/attachment-system.ts`.

What this repo has now: the library `Transcript` (speech, own message, event chips, edited flag, interim, per-bubble copy, **code blocks with fences/blocks, per-block copy, `renderCode` slot**), `Panel` + `useFollowLatest` (stick to bottom, Jump to latest pill, fade, thin scrollbar), `Input` panel variant with an `actions` slot (mic red only while dictating, send muted until text), `Steps` checklist, `Empty` tile, `Progress` ring, `Toolbar`/`SplitButton`/`ActionMenu`. In the app: the Studio transcript tab, the overlay chat log, the native panel views and the CodeMirror `code-canvas`.

Where we are ahead: the Legion chat has **no jump-to-latest pill**, no `role="log"`, no edited flag, no event chips, no see-through tokens. Do not copy those gaps.

## Gaps, in priority order for an interview-assistant panel

### P1: build next
1. **Attachments (the one named by the owner).** Not present in the library or the app (the "To apply" screenshot tray is the only relative).
   - `AttachmentCard` shared by the composer (removable) and the transcript (read-only): kind icon (caller-supplied node), name, `TYPE · SIZE` meta line that becomes the error text or "Uploading…", remove button disabled while uploading, `aria-label="Remove {name}"`; no thumbnails by default (an `image` kind may add one).
   - `AttachmentStrip` above the field: one horizontally scrolling row, `aria-label="Selected files"`, so files never push the textarea.
   - Add paths: picker button with count badge (input value reset so the same file can be re-picked), **drag and drop** (clear `dragging` only when the pointer leaves the container's bounding rect, to avoid child flicker; placeholder becomes "Drop files here…"), **paste** (images from the clipboard become `screenshot` attachments).
   - Limits as config: `maxCount` (Legion 14), `maxSize` (Legion 100 MB client, 20 MB bridge), `allowedTypes`; rejections reported through a callback (a toast), never silent. **Use one allowlist for the picker `accept` and the uploader** (Legion's differ, which is a bug to avoid).
   - Lifecycle: kept local until submit; one predicate ("will this be sent?") shared by the sender and the transcript snapshot so a card never reads as sent when it was not; a failed send rewrites the card to "Not sent".
   - Text files inlined into the prompt with a truncation header ("first N of M characters"), owner decision.
   - Library shape: data/config driven (`attachments`, `onAdd`, `onRemove`, `accept`, limits, `uploadProgress`), icons as nodes; slot in `Input` `actions`/a new `Input` `leading` strip rather than a Composer component.
   - Privacy: our AGENTS.md rule 8 (never log attachments) and ADR-0012 (screenshots are private artifacts, served as downloads) apply to the app wiring.
2. **Markdown rendering for replies** (react-markdown + remark-gfm; math optional). Our code blocks cover only fences. Legion's **streaming-safe auto-closer** (`autocompleteStreamingMarkdown`: closes an open fence, backticks and `**` mid-stream, ignores code) avoids flicker; our `parseFencedBlocks` already keeps an unclosed fence as text, which is the cheap half. Highlighting stays a host slot (`renderCode`); Legion registers a small Prism set (ts, js, json, bash, python, css, html, yaml) with text fallback, and a `--ui-text-scale` knob for code size.
3. **Stream status line**: typed `kind: tool | reasoning | stall`, `mm:ss` elapsed timer, "Calling {tool}…", "{tool} completed", "{tool} failed", stall message. Our Answer panel has the `Steps` checklist; this covers the finer-grained line under a streaming bubble.
4. **Failure card with Retry**: plain-language failure ("The agent is unavailable right now") instead of raw errors, raw error logged in dev only, **Retry re-sends the originating prompt**. Pairs with our agent-gateway failure states.
5. **Send becomes Stop** while a reply is running (label "Thinking…"). Our Stop lives in the Answer header; the composer should offer the same affordance for chat replies.

### P2: soon
6. **Prompt history with caret-at-edge rule** (↑/↓ recall only on the first/last line, ⌘↑↓ anywhere) so multiline drafts stay editable.
7. **Toasts + escape stack**: stacked auto-dismiss toasts (5 s, dismiss ×, optional sound), and an Escape stack (`pushEscapeCloser`) so Esc closes only the topmost layer (menus, dialogs, rings). Needed once menus live in native portals.
8. **Message context menu / hide / delete** (copy message, hide, delete with inline confirm) and **download conversation as Markdown**.
9. **History windowing + "Load earlier"**: 50-message window, scroll position preserved across the load (`scrollBottom` before, restore in rAF). Our Transcript renders everything.
10. **Save indicator** (`idle | saving | saved | conflict | error`, `role="status" aria-live="polite"`, Retry before any destructive reload) and **answer recovery** snapshots (pending + acknowledged, never claim "saved" from local storage alone). Relevant to session notes and Rehearsal answers.
11. **Dictation extras**: lazy engines, `{finalText, interimText}` updates, live waveform behind the field, permission asked only on click. We have the mic states; no waveform or interim text in the composer.
12. **Context ring** (context-window usage with Refresh/Compact) if we expose model context.

### P3: when a product needs it
13. **Question widget** (`choice | multi | text | yesno | scale`, one at a time, progress bar, required gating) and a **page-level validation summary** (count, list, jump to first; not cleared by an empty report so the layout stays still). Missing in Legion too: back, review/summary screen, skip. Natural home: Rehearsal.
14. **Structured widgets** (table, cards, gallery with lightbox, stats, timeline, progress). Only if answers stop being Markdown.
15. **Presentation flags with `FULL` / `BORING` presets** consumed by a hook; a component whose flag is off returns null. Good pattern for shipping the same library to the native panel, the web Studio and Presentation.
16. **Mentions / slash / `@` file refs**, queue dock, approval modal: only if the assistant becomes agentic in the panel.
17. **i18n**: Legion has none (inline English). We have none either; decide before the website refactor so the string props on the new components stay the contract.

## Conventions worth borrowing
- Skin by **re-pointing tokens inside one root class** rather than editing vendored CSS (we already do this with `--oui-*` mapped from `--ui-*`).
- "Absent optional action hides its control; no clickable no-ops" (matches our capability rule).
- Real components, real store, no mocks in tests (our library tests already render real components).

## Website refactor note
The app's transcript surfaces are separate implementations today (Studio `transcript-tab.tsx`, overlay `chat-log.tsx`, native `panel-views.tsx`, `code-canvas.tsx`). The library `Transcript` + `Panel` + `Input` now cover the native one; the Studio tab's extra rows (source chips, corrected, gaps, disconnect, no-question, task rows, private screenshot downloads) map to **event chips** and, for screenshots, to the **attachment card in read-only mode** (item 1), which gives one component for "screenshot attached to this turn". Reuse the code-canvas CodeMirror setup as the `renderCode` host highlighter.
