# Interview Studio Workspace (redesign sub-project 2 of 6)

Status: implemented 2026-10-01 on `master`. The operator approved the approach in conversation (answer guide + rendered Markdown) and then authorised implementation end to end. Follows [the shell spec](2026-10-01-studio-shell.md).

## Outcome

The Workspace view in the assistant host (`/t/local/p/interview/work?artifact=…`) is the design's staged workspace:

- a header with the question title, language, draft save state, a **Versions** menu and **Run tests ⌘↵**
- a five-stage stepper: Understand → Plan → Code → Test → Explain
- the current stage on the left, built from a typed **answer guide**
- on the right, the code (solution, usage, tests) with a results panel: **Tests / Output / Problems**

New questions open on a "What's the question?" screen offering *Solve it myself*, *Draft with assistant* and worked examples.

## Decisions (operator answers)

| Question | Decision |
|---|---|
| Where stage content comes from | Typed, versioned `guide` on the coding answer (not parsed Markdown, not a separate artifact) |
| Guide vs `answerMarkdown` | **The guide is the source.** The server renders the five required headings from it (`renderGuideMarkdown`), so the CLI, skills, Playground control and saved versions read unchanged Markdown. If only the Markdown is edited, the stale guide is dropped (`reconcileAnswerGuide`). |
| Stage progress | Saved on the draft as `progress: { stage, clarified[] }`, never inside the answer. The scratchpad reuses `notes`. |
| Old inspector (Notes / Output / Saved) | Removed. Results live under the code. Saved versions sit in a **Versions** menu: save a version, list versions, restore one into the draft. |
| "Draft with assistant" | Calls the existing generate endpoint directly. The assistant package's host API cannot send a message, so a chat-driven draft would need a change to the vendored package. |

## Contracts (`@omnitech/interview-contracts`)

- **`guide.ts`**:
  - `answerGuideSchema` (v1), containing:
    - `understand` {prompt, examples, constraints, clarify}
    - `plan` {steps, complexity}
    - `edgeCases[{name, test?}]`
    - `explain[{heading, body}]`
    - `talkingPoints`: an array of exactly 3, not a tuple, because the assistant server's strict Ajv rejects `prefixItems` without min/max
  - Also exports `stageProgressSchema`, `renderGuideMarkdown`, `guideText` (flat text for review diffs and claims) and `reconcileAnswerGuide`.
- **Run results:** `runResultSchema` gains optional `tests[]`, holding `{name, status, durationMs?, message?, location?{editor, line}}`, and `diagnostics[]`, holding `{line, column?, message}`. Both are optional, so existing receipts and clients are unchanged.
- **Answers:** `generatedAnswerSchema.guide` is optional and never defaulted, so old rows read back identically.
- **Claims:** `interviewClaimSchema.field` accepts `"guide"`.
- **Generation prompt:** asks for `guide` instead of hand-written `answerMarkdown` and keeps "bold key terms" as a rule for guide text.

## Code runner (`@omnitech/code-runner`)

- **Structured reports.** Test runs also write a structured report to a single writable mount, `/out`:
  - Vitest: `--reporter json --includeTaskLocation`
  - RSpec: `--format json`
  - Pest: `--log-junit`

  `reports.ts` parses each into `tests[]`. `testSourceMap` maps lines in the joined test file back to the person's **solution** or **tests** editor, accounting for PHP tag stripping.
- **Syntax check.** `checkSyntax` returns `diagnostics[]`: the TypeScript checker now prints `line:col: message`, PHP's line is shifted for its prepended tag, and Ruby uses its caret detail.
- **Timeouts.** Test runs get `testTimeoutMs` (default 20 s); plain runs keep 5 s.
- **Real-image checks.** These were exercised against the real Vitest, RSpec and Pest images (built locally), not only fixtures.

## Backend

- **Drafts.** `interviewDraftSchema` gains `progress`. `InterviewWorkspaceRepository` create and edit apply `reconcileAnswerGuide` against the previous answer.
- **Assistant adapter:**
  - The model may send `guide`, and a new answer may omit `answerMarkdown`.
  - **Guide** is one review surface: its rendered Markdown is not listed separately, and picking Guide carries that Markdown and its claims.
  - Claims may cite the guide.
  - Personal-statement and metric checks cover the guide's Explain prose (`answerProse`).
  - Prompt version is now `interview-grounding-3` and schema version `interview-claims-2`.
- **Generation.** `generateInterviewAnswer` accepts a guide or older-style Markdown, renders Markdown from a guide, and raises `maxOutputTokens` to 12 000.
- **Hand-written answer copies.** `interview-playground-control` passes `guide` through (validated where stored or shown). The CLI's public answer type includes it.

## Frontend

- **`studio/workspace/`:**
  - `use-canonical-draft` (load, autosave 0.8 s after the last edit, serialised PATCHes, conflict state, reload after an assistant change, idempotent run and save, versions)
  - `stages` (config)
  - `stage-panes`
  - `coverage` (edge cases → named tests → last run: passing / failing / not run / no test / not found)
  - `code-panel` (file tabs, CodeMirror with plain-PHP mode, go-to-line, line marks, assistant diff preview, results panel)
  - `new-question`
  - `versions-menu`
  - `assistant-change` (banner and diff, moved from the legacy view)
  - `workspace-view` (composition and the shell binding)
- **Shell registry.** The shell's `work` view renders `WorkspaceView`.
- **Legacy `Workspace`.** Now local-mode only (used by `apps/web`); assistant and embedded modes were removed (−573 lines), along with their two test files.
- **Shared templates.** The example templates moved to `example-templates.ts`.
- **Styles.** Workspace styles are in `studio/workspace/workspace.css`, imported by the studio stylesheet. The assistant banner and diff styles moved there from the host. `apps/frontend/src/style.css` is gone.

## Behaviour changes worth knowing

- **Draft autosave.** Draft edits are saved about 0.8 s after typing stops. Previously they were saved only before an assistant send, a run or a save, so a reload could lose them. Saved *versions* remain explicit.
- **Syntax checks in assistant mode.** The syntax check now runs here too: it is read-only and the host allows the endpoint.

## Verification

- `pnpm verify` passed:
  - lint, format, typecheck and build
  - 525 tests
  - coverage 90.88% statements, 81.8% branches, 90.46% functions
- **Browser** (operator's Chrome, assistant host):
  - an old answer without a guide falls back to its Markdown
  - Run tests showed per-test rows ("5 / 6 passed · 1.4 s"); "Go to line 67 (solution)" scrolled to and marked the throwing line
  - a new question was drafted by the local model (qwen3-coder-30b) **with a full guide**
  - Understand, Plan, Code, Test (edge cases matched to real results) and Explain (timer) all rendered
  - stage and ticked questions survived a reload
  - saving a version listed it
  - a typed syntax error showed in Problems (`solution.ts:21:1`) and the line was marked
  - the narrow header was fixed
- **Bugs found in the browser and fixed:**
  - two quick ticks lost one; edits are now computed from the latest draft
  - the sidebar list did not refresh after a rename; it now refreshes on a title or question change
  - an edge case with a misnamed test showed "no test"; it now shows "not found in tests"

## Not done

- **"Explain failure" and "Add test"** need a send API on the assistant host. They are left out rather than shown as buttons that do nothing.
- **Restoring a saved version** replaces the draft after a confirmation. Saved versions are not shown read-only.
