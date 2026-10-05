# Native Panel + Live Session Web: implementation plan, matrix and TODOs

Owner: tech lead (this session). Branch `feat/active-session`, base `af62649`. Working artifact; statuses are updated as work lands.
Evidence: [native-gap.md](native-gap.md) (rows A-01..A-30), [live-gap.md](live-gap.md) (rows B-01..B-46), [studio-feature-matrix.md](../studio-feature-matrix.md) (what already existed).
Objectives context carried to every worker: `bionic/objectives.md` (private, tenant-isolated preparation; never log content; the app never types or submits for the person).

## 0. Design sources actually inspected

| Source | Result |
|---|---|
| `claude_design` MCP (`https://api.anthropic.com/v1/design/mcp`) | **Not connected in this session; not used.** The only design tool available (`DesignSync`) syncs design-system projects, not prototypes. |
| `~/Downloads/Native Panel.html`, `~/Downloads/Live Session Web.html` | **Inspected.** Both are bundler exports; unpacked from the `__bundler/manifest` and `__bundler/template`. Read in full: markup, the prototype script (`PROBS`, `STEPS`, `SKILLS`, `capture`, `stopWork`, `renderVals`) and every state. Fonts and the preview runtime are not carried over. |

Prototype-only items are never transplanted: timers, `PROBS`/`TASK` sample content, `K7QF-29XM-PL4D`, fixed counts, "Claude · sonnet" literal, `setTimeout` delete.

## 1. Decisions (made by the tech lead)

| ID | Decision | Why |
|---|---|---|
| D01 | **One additive, optional, content-free contract field** (T01b: the source observation ids on `LiveAction`, already stored in `session_actions.source_event_ids`); no migration. Ordinals `S{n}`/`T{n}` are derived client-side (screen.snapshot observations in sequence order; tasks in creation order). Revised after T01 found the wire action had no link to its screenshot. | Gap reports found the server already accepts any target, stop-work, tighten, shorten, credential. Simplicity first (ADR-0002). |
| D02 | Design sections APPROACH / BRUTE FORCE / OPTIMAL / SAY OUT LOUD for coding tasks are **not** built as structured data. The Answer tab renders the existing `answer.draft` and `codingBrief.restatement`. | No backend data exists; adding fields needs an ADR and a stage change. Recorded deviation. |
| D03 | Answer style list stays the **contract's 9 skills**; the dropdown is derived from the contract. Design's Frontend/Debugging are not added. The **page is the single owner** of the skill; Swift cycling and Swift persistence are removed; ⌘↑/⌘↓ stay as intents delivered to the page. | Two sources of truth drift (native-gap §2). Contract extension is not required by any behaviour. |
| D04 | Stop is **session-wide stop-work** (existing server semantics) on both surfaces, labelled "Stop analysis"; per-task cancel is not built. The web capture card gains the real stop; "stop sharing" stays a separate control. | Server stop is fenced and replay-safe; prototype per-task stop is a local flag. |
| D05 | Click-through: fix the compact window so ⌘⇧I really ignores mouse events; the in-overlay "Interact" button is **not** built (impossible with `ignoresMouseEvents`); the banner is a non-interactive hint and ⌘⇧I is the exit. | native-gap A-08/A-08b. |
| D06 | Ended (native): keep the last answer readable under an ended card (stats from the snapshot, "Open summary" via the existing `openExternal`, "Start a new session"). | Prototype wipes the person's own content. |
| D07 | Setup host cards (Mac app / This browser) show **real** capability and install state from `studioHostInfo()` and `GET /companion-capability`. Never claim "listening" before a recorded heartbeat. "Start in Mac app" only if a real URL scheme exists; otherwise the Mac card starts the session and the native window adopts it (existing behaviour). | Plain browser cannot know the Mac app is installed. |
| D08 | Consent stays required for **all** targets (safer than design). No new consent field. Copy stays "does not store your answer". | Server cannot attest consent; no ADR planned. |
| D09 | Tombstone/history show only facts the server holds (started, ended, hints counted). The design's "1 task" and target title are dropped. | Needs a content-bearing field + migration for little value. |
| D10 | Revoke toast and state derive from the refreshed session status; never assume a pause. | Server revokes and pauses only an active session. |
| D11 | Delete shows purging until the server reports `purged`; handle `purge_incomplete`. Already implemented; keep tests. | Prototype timer is wrong. |
| D12 | One **shared model layer** feeds both surfaces: task card model (stages Answer/Code/Fully verified, test badges, model chip, earlier-task flag, ordinals), target resolver, shortcut table, skill table, clipboard helper. Visual layouts stay per surface; shared presentational primitives only where markup is genuinely the same. | Non-duplication principle; avoids two drifting `panel-model` / `session-tasks` variants. |
| D13 | Follow-up and add-screenshot **always** carry the selected task's `{taskId, revision}`; the "newest action" resolver is deleted (no fallback). | Historical viewing must not redirect context. |
| D14 | Native is **one window** (+ Settings window). Multi-panel layouts, presets, panel move/resize keys, PiP branch, dead opacity feature are removed in the cleanup package, coordinated across Swift and TS in one change. | Superseded by the compact default; no legacy side by side. |
| D15 | Auto limits (8 s default, 3-30 clamp, 120/session, change threshold) stay in one config (`auto-interval.ts`/`auto-gate.ts`) and feed the strip, menu subtitle and keys popover. ADR-0022 text (30/session) is corrected to 120 in the cleanup package. | Design and code agree on 120; ADR text is stale. |
| D16 | Shortcuts: one typed table (chord, label, intent, platform) drives the keys popover and the web's own bindings; Swift `Hotkeys.swift` stays its own table; a vitest parity check reads the chord list from the Swift file to catch drift. | Cross-language drift protection without a generator. |
| D17 | Missing-context journey (exists since `af62649`) is hardened and verified live **after** cleanup (T08, then T10). Its permission/capture failures stay a distinct code path. | Brief §8. |

## 2. Feature / state matrix

Status values: `existing and verified`, `partial`, `missing`, `prototype-only`, `implemented but unverified`, `verified`, `blocked`. "Now" is the status at plan time; the last column is filled at the final gate.

| ID | Capability | Now | Rows | Owner task | Acceptance | Final evidence |
|---|---|---|---|---|---|---|
| F01 | Rehearsal vs linked-interview setup, consent, validation, start | existing and verified (copy/structure differ) | B-02,03,04,14 | T04 | setup-view tests; sticky footer shows reason; single start flow | |
| F02 | Mac vs browser capture host cards, install/permission truth | missing (cards), partial (capability data) | B-05,06,07,22 | T04, T05 | cards from real capability data; no listening claim without heartbeat; Pair-companion CTA reveals credential | |
| F03 | Matrix selection, revision, no-matrix, grounded claims | existing and verified | B-08,09 | T04 | pinned revision test retained | |
| F04 | Policy, truthful locality, retention, one-way tightening | existing and verified | B-10..13,17,43,44 | T04, T05 | duplicate policy control removed; server tests retained | |
| F05 | Floating draggable panel, pane toggles, mic, answer style, shortcuts, click-through | partial | A-04,05,07..10,09,28,30 | T02, T03 | skill dropdown; keys popover; click-through live on compact window | |
| F06 | Manual/Auto capture; new-task; stop current only; same-task screenshot | partial | A-01..03,11,12; B-23 | T03, T05 | menu subtitles + T-number; Stop on web capture card calls stop-work; Auto strip from `auto-line` | |
| F07 | Task identity, revisions, screenshot provenance, stages, tests, distinct confidence labels | partial | A-19,20,21,23,24; B-26..30,34 | T01, T03, T06 | shared task card model; badges Generated / tests n/n only if reported / Not fully verified | |
| F08 | Multiple tasks, earlier-task selection, selected-vs-current, back to current | partial (native: no chips) | A-13; B-24 | T01, T03 | chips + earlier tag native; web existing retained | |
| F09 | Transcription/source attribution, typed questions, follow-ups, context, pending, responses | partial | A-14,15,17,18,29; B-25,33,36 | T01, T03, T05 | follow-up targets selected task; pending row; speaker labels from `sourceId` only | |
| F10 | Transcript/Activity/Sources tabs, source health, gap warnings, reconnect, pairing | partial | B-16,22,35,36,37,38 | T05 | Sources dot; one source-health presenter; Reconnect only through a real bridge action | |
| F11 | Pairing credential: scope, expiry, reveal/copy, revocation | existing and verified | B-39..42 | T05 | no static code; masked memory-only retained; revoke derives from status | |
| F12 | Shared session identity, handoff, pause/resume, confirmed end, cancel, stale rejection | partial | A-25,26; B-15,18..21 | T02, T03, T05 | one Pop out; end confirm copy accurate; cross-surface sync test | |
| F13 | Clipboard, Workspace handoff, summaries/counts, history, retention/deletion, fresh session | partial | A-22,26; B-31,32,45,46 | T01, T03, T06 | real clipboard with result; ended card + Open summary; purge re-read | |
| F14 | Missing-context journey: trigger, explanation, supply/correct, validate, retry, result | implemented but unverified (live) | trace in baseline | T08, T10 | regression per layer + UI e2e + live run on final build | |

Prototype-listed controls with no handler in the design (all inventoried): keys popover lists `⌘⇧V show/hide`, `⌘⇧C chat`, `⌥⇧U Auto`, `⌘,` Settings, `⌘↑⌘↓` skill - all registered natively (T02 fixes ⌘⇧C, ⌘,); Session history button (web, empty handler) is wired to the existing paged history (T06).

## 3. Work breakdown (TODOs)

Sequencing: **P1** T01 ∥ T02 → **P2** T03 ∥ T04 ∥ T05 ∥ T06 (all after T01) → **P3** T07 ∥ T08 → **P4** T09 review → **P5** T10 gate (lead).
Each task: file ownership is exclusive; shared-file edits go through the owner named. Each task deletes what it supersedes in its own area and adds regression tests.

| ID | Owner | Scope / files | Depends | Observable completion |
|---|---|---|---|---|
| T01b | worker-contract | `live-session.ts` (LiveAction field), backend read mapping, `shared/task-card-model.ts` provenance | T01 | `snapshotLabel` non-null for owner captures; tests | [ ] |
| T01 | worker-shared | `live/shared/**` new (task-card-model, ordinals, target resolver, shortcuts table, skills table, clipboard); `session-owner-input.ts`, `session-actions.ts` target param; minimal call-site edits; delete `latestTarget` | - | **DONE**: tsc clean; 235+461 targeted tests green; API in briefs/T01-api.md | [x] |
| T02 | worker-swift | `apps/studio-shell/**`, `packages/interview-contracts/src/studio-host.ts` (+native-adapter): click-through on compact; `focusChat` + in-window settings; skill single owner; drop capture "Current Skill" toast; Swift tests | - | `swift test` green; bridge decode tests; live check of ⌘⇧I/⌘⇧C/⌘, | [ ] |
| T03 | worker-native-ui | `overlay/panels/**` (single-panel, panel-views, panel-model, toolbar-config, panels.css) | T01 | A-rows done; panel tests; screenshot of each state | [ ] |
| T04 | worker-web-setup | `setup-*.tsx/.ts`, `use-setup-choices.ts`, `hands-free-choice.ts`, `setup.css`, `capability-table.tsx` as needed | T01 | W1 rows; duplicate controls removed | [ ] |
| T05 | worker-web-live | `live-session-view.tsx`, `session-bar*`, `session-banner*`, `banner-copy.ts`, `hands-free-controls.tsx`, `use-hands-free.ts`, `sources-tab.tsx`, `pairing-panel.tsx`, `session-tabs.*`, nav dot (`config/views.tsx`, `sidebar.tsx`) | T01 | header, banners, capture card + stop, side rail | [ ] |
| T06 | worker-web-task | `task-panels.tsx`, `coding-panel.tsx`, `answer-body.tsx`, `code-canvas.tsx`, `ended-*.tsx`, `ended.css`, task CSS | T01 | stage tiles, tabs, header meta, model chip, ended polish | [ ] |
| T07a/T07b | worker-cleanup (a: TS outside overlay, backend, apps/web deps, ADR-0022; b: overlay/**, Swift, bridge contract, D14) | Cross-language removal (D14, opacity, unrouted card stack, duplicate `CompanionReport`, third source-health renderer, `auto-change.ts`, test-support relocation), ADR-0022 text, knip/jscpd/ast-grep rerun, ledger | T02-T06 | ledger; analysers re-run; `pnpm verify` | [ ] |
| T08 | worker-missing-context | Tests only + minimal fixes in the missing-context path: backend, hook, both UIs, e2e through UI | T03,T05 | all brief §8 cases covered | [ ] |
| T09 | reviewer | Independent diff review vs this matrix; challenge cleanup deletions | T07,T08 | findings file; MUST-FIX closed | [ ] |
| T10 | lead | `pnpm verify`, swift build/test, rebuild bundle, install, live missing-context run, final report | T09 | evidence in column above | [ ] |

## 4. Conflicts and resolutions (design vs repo)

See live-gap §2 (14 items) and native-gap §3 (8 items). Resolutions adopted verbatim as D04-D11 above.

## 5. Cleanup ledger

Filled by T07 (finding, resolution, canonical replacement, verification). Baseline: scratchpad `baseline/` (Knip, jscpd, ast-grep, Swift warnings).

## 6. Journal

- 2026-10-04: discovery complete (native, web); tooling baseline in progress.
- 2026-10-04: P2 delivered and committed as 5b306c3. Gate: all tests green except load-sensitive hardening/latency test (2175>2000 ms once, 3/3 pass alone, machine load avg 8-17); build green. Fixed my own finding: shortcuts parity test now finds repo root (failed when run from repo root). T07a/T07b launched. T08 ordered after T07.
- 2026-10-04: T01 and T02 delivered. T01 deviation: `snapshotLabel` is always null (wire gap) -> T01b. T02 left for T03: page handler for `chat.focus`, remove dead `skill.set:` branch; for T07: layout presets, panel kinds, opacity, move/resize keys. P2 workers T01b/T03/T04/T05/T06 launched.
