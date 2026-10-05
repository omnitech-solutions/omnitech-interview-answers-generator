# Code views inventory: main app vs active session vs panel code pane

Read-only discovery. Paths relative to `products/interview/src` unless noted. FE = `frontend/studio`.

## Key facts first

- A `solve-code` action result is built in `backend/live-session/coding-path.ts:311-353`. Keys: `version stage language code usageCode testCode coverage escalation notes states tests run syntax repair agent replacesRevision meta` (plus `workspace`, `generatedBy`, added elsewhere). The whole result JSON reaches the browser (`backend/live-session/session-reads.ts:211-270`), and `FE/live/session-results.ts:168-261` (`parseCodeResult`) parses it.
- **The generated TEST SOURCE is delivered to the client**: `testCode` (and `usageCode`) are in the result and in `CodeResult` (`session-results.ts:212-214`). The Live web canvas already shows it (Solution | Usage | Tests tabs, `FE/live/overlay/code-canvas.tsx:44-48,319-336`).
- **Per-test detail is NOT delivered**: `verify()` keeps only `{name,status}` (`coding-path.ts:122-126`). `durationMs`, `message`, `location`, stdout, stderr and syntax `diagnostics` from the runner (`packages/interview-contracts/src/schemas.ts:107-118`, `guide.ts:139-160`) are dropped before storage. Stored: counts, `results[<=50]` names and statuses, `run{available,exitCode,timedOut,durationMs}`, `syntax{checked,clean}`.
- `tests.location.editor` (`guide.ts:139-151`) is `"solution" | "tests"`: which editor a failure line belongs to, so the main app's "Go to line N (solution)" button (`FE/workspace/code-panel.tsx:352-367`) switches tabs and scrolls. It does not exist in an active-session result, so a failed test cannot be jumped to there until `message`/`location` are stored. With a Tests drawer, `editor: "tests"` would mean "reveal the line in the drawer".
- `coverage` (constraintIndex -> testName) is stored (`coding-path.ts:317`) but not parsed by `codeSchema`; it is already used server-side for `fullyVerified` (`backend/live-session/code-states.ts:89-148`).
- The panel code pane gets only `card.code = {language,text,revision}` (`FE/live/shared/task-card-model.ts:315,357`); `CodeCard` (`overlay/panels/code-card.tsx:22-79`) shows language, Copy, three badges (generated / "n/m tests" / fully verified) and the solution read-only. No tabs, no run (file header says so). `answer-pane.tsx:277-296` renders it.

## 1. What the main app shows around code and tests

Legend for the last two columns: Live = Live web `coding-panel.tsx` + `code-canvas.tsx`; Panel = native panel code pane. Wire = in active-session result today.

| Item | Main app evidence | Data source | On wire? | Live web | Panel pane |
|---|---|---|---|---|---|
| Solution file tab (language file name, e.g. `solution.ts`) | `workspace/code-panel.tsx:177-190`, `stages.ts:23-45` | `answer.code`, `FILE_NAMES` | yes (`code`) | yes | solution only, no file name |
| Usage/example tab | same, `FILES` | `usageCode` | yes | yes | no |
| Tests file tab | same | `testCode` | yes | yes | no |
| Language label / switch | `LANGUAGE_LABELS`, `stages.ts:47-52` | `language` | yes (no switch; session language fixed by brief) | chip | yes (label) |
| Run all (Run tests, Cmd+Enter) | `workspace-view.tsx:505-515` -> `/api/v1/run-all` (`runAllRequestSchema`, `schemas.ts:100`) | runner | n/a (action) | yes (Run button, edits re-run) | no; hands-free app never runs for you |
| Per-test list: status, duration, failure message | `code-panel.tsx:327-374` | `TestResult` | names+status only | status only (`workerRun` zeroes duration, `code-canvas.tsx:85-102`) | counts only |
| Go to failing line / editor | `code-panel.tsx:352-367` | `location{editor,line}` | no | no | no |
| Console output (stdout/stderr) | `code-panel.tsx:282-288` | `RunResult.stdout/stderr` | no | empty after worker run, filled after own Run | no |
| Syntax diagnostics (Problems tab, red lines) | `code-panel.tsx:377-411`, `workspace-view.tsx:295-318` -> `/api/v1/syntax-check` | `Diagnostic{line,column,message}` | only `clean` boolean | no | no (verified badge reason only) |
| Run summary, exit code, timeout, duration | `code-panel.tsx:71-82` (`summary`) | `RunResult` | yes (`run`) | yes (`resultsSummary`) | no |
| Generated/passed/fully-verified states + reasons | n/a in main app (Live-specific) | `states{generated,testsPassed,fullyVerified,reasons}` | yes | yes (Badges) | badges yes, reasons no (stage detail only) |
| Constraint -> test coverage | `workspace/coverage.ts`, `stage-panes.tsx:236-258` (edge cases mapped to tests) | `coverage[]`; main app uses `guide.edgeCases[].test` | yes (not parsed in FE) | constraint list yes, mapping no | no |
| React preview | not found in frontend (grep: no iframe/srcdoc/sandpack); `preview` in `code-panel.tsx` means previewing an assistant's proposed change (`assistant-change.tsx:13-60`) | `ProposalRecord` | n/a | n/a | n/a |
| Complexity (time/space/note) | `stage-panes.tsx:210-235` | `guide.plan.complexity` | no (coding stage has no complexity field) | no | no |
| Edge cases w/ test status | `stage-panes.tsx:236-310`, `coverage.ts:38` | `guide.edgeCases` | partly (draft edgeCases built from coverage, `session-drafts.ts:135`) | no | no |
| Explanation / talking points | `stage-panes.tsx:312-345` | `guide.explain`, `talkingPoints` | prose answer text yes, not structured | Answer tab | Answer pane |
| Approach note | n/a | `notes` (<=500 chars) | yes | no | no |
| Hints / coaching per stage | `stages.ts:5-15` | static copy | n/a | no | no |
| Revisions / versions | `versions-menu.tsx:8-70`, `use-canonical-draft.ts` | `SavedAnswer[]` | task `revisions[]`, `replacesRevision` | "Solution for rev N / replaces rev M" (`coding-panel.tsx:268-275`) | revision number in card model only |
| Outdated solution warning | n/a | `codeStale` | yes | yes | no |
| Repair attempted/succeeded | n/a | `repair` | yes | no | no |
| Copy file / copy all | `code-panel.tsx:192-200`; canvas `copyAll` `code-canvas.tsx:218-224` | text | yes | yes | solution only |
| Download | not found in workspace | n/a | n/a | no | no |
| Edit in place | `code-panel.tsx:207-217` | `onChange` | n/a | yes, with "revision available" bar | read-only (rule: never types for you) |

## 2. Gap list (main app shows, panel code pane does not)

| # | Gap | Mid-interview value | Data | Privacy (rule 8) | Effort (lines) |
|---|---|---|---|---|---|
| G1 | Tests file view (generated test source) | High: lets you say what is covered and read tests aloud | on wire (`testCode`) | already shown on Live; display only, never logged | ~120 (drawer) + ~25 (extend `taskCardModel.code`) |
| G2 | Usage/example code tab | Medium: concrete call to narrate | on wire (`usageCode`) | same | ~30 (tab in same card) |
| G3 | Per-test list with status and counts (generated / passed / failed / skipped) | High: honest verification picture | on wire (`tests.results`, counts) | names are model text, already visible on Live | ~60 |
| G4 | Constraint -> test mapping ("Covered by: name") | High: ties tests to what the interviewer asked | on wire (`coverage`); needs `codeSchema` field | model text only | ~40 |
| G5 | Failure message + "go to line" | High when a test fails; shows why | needs backend: keep `message`,`location` in `verify()` and `testSchema` | runner output can echo values; bound (e.g. 300 chars/test), store, never log; same class as generated code | ~45 backend + contracts, ~40 UI |
| G6 | Syntax problems list | Medium: only `clean` today | needs backend (`diagnostics` bounded) | line numbers and messages about generated code | ~35 |
| G7 | Per-test duration, stdout/stderr | Low | needs backend | stdout may contain content; recommend NOT storing | skip |
| G8 | Complexity (time/space) | High in interviews: the follow-up question | needs a coding-stage schema field (`complexity{time,space}`, prompt change, tests) | model text | ~60 |
| G9 | File name per tab | Low | derivable (`FILE_NAMES`) | none | ~5 |
| G10 | Verified reasons ("why not fully verified") inline | Medium | on wire (`states.reasons`, `STATE_REASON`) | none | ~15 |
| G11 | Repair attempted/succeeded; notes | Low-medium ("fixed after 1 repair") | on wire | none | ~10 |
| G12 | Run (re-run) and edit | Excluded by design (hands-free, never types) | n/a | n/a | n/a |

## 3. Proposal: Tests drawer `|>|`

Behaviour
- Left edge of the code pane carries a narrow handle button (icon `|>|` when closed, `|<|` when open). Click or Enter/Space toggles; `aria-expanded`, `aria-controls`, accessible name "Tests". Shortcut proposal: `T` while the pane has focus (declare in the shared `shortcuts.ts` table).
- Open/closed persisted per host in the panel's existing settings store (same mechanism as other panel prefs; try/catch, default closed). Drawer width fixed (~45% of pane, min 160px); the pane does not reflow the toolbar.
- Contents, top to bottom: (1) counts strip from `tests`: Generated (`states.generated`), Passed n, Failed n, Skipped n, from the server counts only, never recomputed; (2) honesty line, always visible: "Generated tests passing is not full verification." plus `Not fully verified: <reasons>` when `fullyVerified` is false (reuse `badgesOf` and `STATE_REASON`, one definition); (3) per-test list: status icon, name, "covers: constraint N" (G4); failed rows show `message` and a line link when G5 lands, else the honest note "Failure details not available"; (4) read-only highlighted `testCode` (same CodeMirror config as `CodeCard`, line numbers on), with a Copy button via `shared/copy-text.ts`.
- Unavailable states: no `tests` and no runner -> "The code runner was not available, so no test result is claimed" (existing wording, `coding-panel.tsx:306`); `testCode` empty -> "No test source was published".
- Solution/Usage switch can ride the same card as a second small tab row (G2), keeping the drawer for tests only.

Data needs
- Available now: `testCode`, `usageCode`, `tests{total,passed,failed,skipped,results[name,status]}`, `states`, `run`, `syntax`, `repair`. Backend change: none for v1.
- Contract/FE changes: extend `taskCardModel().code` (`task-card-model.ts:315,357`) to carry `testCode`, `usageCode` and the `tests` block (source: `task.draftCode ?? task.code`, already used by `badgesOf`); add `coverage` to `codeSchema` (`session-results.ts:168`).
- v2 (optional): keep `message` (bounded) and `location{editor,line}` in `verify()` and the stored `tests.results`, widen `testSchema`; add `diagnostics` (bounded) for G6.

New files: `overlay/panels/tests-drawer.tsx` (+ test), small `tests-drawer-model.ts` for counts/rows derived from `CodeResult`; edits to `code-card.tsx`, `answer-pane.tsx`, `task-card-model.ts`, `panels.css`, panel settings table. Rough total v1: ~250 lines with tests.

Tests: model unit test (counts from server numbers, honesty text for passing-but-not-verified, unavailable states); component test (toggle, aria-expanded, keyboard, persisted state, no Run button).
