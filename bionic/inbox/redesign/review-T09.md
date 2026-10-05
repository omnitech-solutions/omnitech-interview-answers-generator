# T09 independent review: redesign and cleanup (af62649..f9667a5)

Reviewer: T09 (read-only). Method: read code, tests and both design prototype scripts; grep for leakage and removed symbols; targeted `vitest run` of `live/shared`, `strip-model`, `toolbar-config` (9 files, 90 tests, pass). Swift was read, not built. Anything marked (inferred) was not exercised.

## 1. Matrix F01-F14: is the claimed status true?

| Row | Verdict | Evidence and gaps |
|---|---|---|
| F01 setup/consent/start | True | `setup-footer.tsx:21-49` shows blocker, `aria-describedby`, one Start. Consent for all targets (D08). |
| F02 host cards | Mostly true | `setup-hosts.ts` derives lines from `StudioHostInfo`, companion report, browser abilities; "Can't tell from a browser" instead of "Installed" (honest). No "Start in Mac app" (D07 deviation). `macLines` window line passes if either `hotkeys` or `pin-on-top` (`setup-hosts.ts:~88`), design says both (NIT). |
| F03 matrix | Not re-verified | Setup diff large; relies on retained tests. |
| F04 policy/retention | Partly verified | Sources tab keeps confirm-gated tighten and shorten (`sources-tab.tsx:60-110, 255-285`), ended retention too. "Duplicate policy control removed" not independently checked. |
| F05 panel, skill, keys, click-through | Partly true | Skill dropdown, keys popover (table-driven), click-through banner and toggle all do real things. Native click-through itself is Swift/live, not verified. The toolbar "Auto/Manual" menu is not the same state as the Auto preference (finding S1). |
| F06 capture, Stop, same-task screenshot | True with gaps | Attach and menu subtitles use `T{n}` (`toolbar-config.ts:55-84`); `⌘⇧S` stops while work runs (`use-panel-session.ts:385-398`). Web Stop shows only once a run exists (`hands-free-controls.tsx:212`, `working`), not during "Capturing…/Analyzing…" before the server run starts. Stop failure leaves UI stuck (S2). |
| F07 task identity, stages, badges | True | Shared `taskCardModel`; both surfaces use it; `snapshotLabel` now from `sourceSnapshots` (`task-card-model.ts:271-277`, `session-reads.ts:166-185`). Design's APPROACH/BRUTE FORCE/OPTIMAL/SAY OUT LOUD sections are absent by D02 (recorded). |
| F08 task chips, earlier task | Partly true | Native chips only render when more than one task (`status-strip.tsx`), earlier tag and "Back to T{n}" ok. Web selector labels "Task n" (`task-panels.tsx:89`) vs native "T{n}": two ordinal computations (S6). Pin semantics differ per surface (M2). |
| F09 transcript, follow-ups, pending | True except one drop | Follow-up carries `targetOf(selected)` on both surfaces; pending row "Answering your follow-up…". Concurrent follow-up drop (M1). Speaker labels from `sourceId` (`session-transcript.ts`) not read. |
| F10 tabs, source health, pairing | True | One `SOURCE_HEALTH` table (`source-health.ts`); Sources tab dot via `sourcesNeedAttention`; no Reconnect button (banner-copy.ts explains why; honest deviation from design "Reconnect"). |
| F11 pairing credential | True | Masked, memory-only, copy reports failure, revoke note derived from refreshed status (`pairing-panel.tsx:21-30`, inferred that refresh precedes render). A11y nit N3. |
| F12 handoff, pause/end, stale | Partly true | Pop out wired (`session-bar.tsx:225-236`, header only). Native end-confirm bug (M3). Pause/Resume real and busy-guarded. |
| F13 clipboard, ended, Open summary, purge | True | `copyText` result-gated everywhere; native ended card + Open summary through `openExternalThroughHost` (`summary-link.ts`) with test; purge states and `purge_incomplete` retry (`ended-retention.tsx`). |
| F14 missing context | Implemented, not live-verified | One strip, one action table, per-surface unavailable reasons. Dismissal sync across surfaces only on reload (N5). |

Prototype controls with empty handlers, checked:

| Control | Result |
|---|---|
| Session history | Real paged list in ended view only (`ended-history.tsx`); design puts it there too (spec line 129). Failed second page keeps list. No cancel on unmount (NIT). |
| Pop out | Real (`presentation.setMode("floating")`). Disabled while floating. |
| Keys popover rows | All real, from `NATIVE_SHORTCUTS`; parity test passes. Lists `⌘↑ ⌘↓` even in click-through where Swift does not register them (`Hotkeys.swift:46-47` `requiresInteractive`). |
| Answer styles | Contract's 9 skills, single owner (page). |
| Click-through banner | Non-interactive hint, exit by `⌘⇧I` (D05). No "Interact" button, as decided. |
| Open summary | Real (native footer and web ended page). |
| Add screen to T{n} | Real, disabled with reason; uses selected task at grab time (`use-panel-session.ts:230-241`). |
| Task chips, earlier-task banner | Real both surfaces. |
| Ended card | Real counts from `model.stats`; "Start a new session" real. |
| Copy buttons | Real; "Copied" only after write succeeds. |
| Stage tiles, Answer/Code tabs | Real (`task-panels.tsx:131-170`, `coding-panel.tsx:25-28`). |
| Source health | Real. |
| Pairing credential/revoke | Real; no static code. |
| Deletion states | Real; no timers. |
| Host cards | Real data. |
| Locality/retention tightening | Real, confirm-gated, one-way copy accurate. |

## 2. Prototype leakage and fakery

Grep for `K7QF`, `Merge k Sorted`, `Binary Tree Maximum`, `Container With Most`, `PROBS`, `Interview Studio.html`: no production hits. Only `Claude · sonnet` appears in a test fixture (`live-session-tasks.test.tsx:216`) and doc comments in `task-card-model.ts:194,309`; the label is derived from `generatedBy`. No `setTimeout` simulating success: remaining timers are toast clear, copy-flash and poll/retry (`session-bar.tsx:69`, `ended-results.tsx:33`, `answer-pane.tsx:32`). Toasts are state-change echoes of real events; none claims an operation that did not run. No fakery found.

## 3. Correctness, security, a11y findings

See section 5 (prioritised). Privacy check: no `console.*` in `live/**`; the only `NSLog` is a window-transparency diagnostic (`NativeSurface.swift:286`), content-free. Shell never types or submits (follow-up is typed by the person; dictation goes to the box only in manual mode, `use-panel-session.ts:296-312`). Content-world fetch (`StudioWebFetch.swift`) is sound.

## 4. Cleanup audit

| Removed | Dependents checked | Result |
|---|---|---|
| `panel-kinds.ts`, `pip-adapter.ts`, `auto-change.ts`, `backend/live-session/index.ts` | grep over products/apps/packages/scripts | No remaining importers (only stale `.next` build output). `auto-change` tests deleted with the dead module; the live interval path (`shouldAnalyze`, `auto-interval.ts`) keeps its own tests. |
| `OwnerSkill.swift`, `PresentationHost.swift`, move/resize hotkeys, layout/opacity ops | `PRESENTATION_PANELS`, `setLayout`, `openPanels`, `setOpacity`, `skill.set`, `panel=pill/analysis/chat` | Only negative tests mention them (`PresentationTests.swift:350-372`, `studio-host.test.ts:148`). No dynamic strings left. `?panel=single|settings` matches `NativeWindowPage`. |
| Docs | grep of `bionic/` outside redesign inbox | Only the historical feature matrix mentions old controls; ADR-0022 wording not re-read (plan marks it done). |

Survivors worth fixing: two `CAPTURE_MODES` tables with different meanings (`toolbar-config.ts:22` screen-only, `hands-free-controls.tsx:386` hands-free); three ordinal computations (`taskOrdinal`, `task-panels.tsx:76-78`, `hands-free-controls.tsx:191` `indexOf+1`); `live-session-view.tsx:135` re-implements `selectedTask`; `TOAST_TEXT.skillChanged` detail "Look in the small tab above" (`use-panel-session.ts:69`) refers to a tab that no longer exists (visible only in a browser-hosted panel); `LiveSessionPanel(_props)` ignores `studio` and `onOpen={() => undefined}` (`live-session-view.tsx:53,59`); `if (taskCount >= 0)` is always true (`use-panel-session.ts:628-630`); three `eslint-disable` remain (`code-canvas.tsx:169,183`, `use-panel-session.ts:590`).

Config-driven principle: `Footer` takes `sessionWording`, `ended`, `starting`, `onStart`, `onOpenSummary`, `clock` flags while `footerButtons` already has a `wording: "short"|"session"` variant (`overlay-footer.tsx:100-140`, `toolbar-config.ts:229-240`): collapse to one discriminated variant. `HandsFreeBar autoControl`, `AnalysisPanel part + autoWatching`, `TaskPanel showWorkspaceLink` are the same smell (NIT). `Shortcut.intent?: string` and `nativeChord(id: string)` are stringly typed: a typo returns `""` silently (`toolbar-config.ts:9-10`); type the id union and `intent: Command`.

## 5. Findings

### MUST-FIX

| # | Where | Why | Smallest fix |
|---|---|---|---|
| M1 | `session-actions.ts:306-315` with `run()` at `:96-100` | `run("follow-up")` is keyed by command and session, so a second follow-up sent while the first is in flight returns the first promise and is never sent. `ChatPanel.submit` (`panel-views.tsx:200-207`) and `send` (`use-panel-session.ts:594-618`) then clear the draft and log the second text as "Typed". A different task target gets dropped the same way. `solveTask` shares the key. Silent loss of the person's message, UI says sent. | Key by `command|session|epoch|requestId`, or serialise follow-ups; or disable the native input and Send while `pending.includes("follow-up")` (web already does via `sending`) and add a test with two sequential different texts. |
| M2 | `use-panel-session.ts:624-630` vs `live-session-view.tsx:123` (`presentation.pin`) | Selection semantics differ: native resets the pin to newest whenever the task count changes; web keeps an earlier pin and shows "Viewing an earlier task. Studio still tracks the newest one." Native pin is per-window React state, web pin is the presentation store; the two surfaces can target different tasks for the same follow-up. Violates "one rule on both surfaces" (D12/D13) and F08/F12 sync. | Decide one rule (design implies keep pin plus banner), use `presentation.pin` from native too, delete the effect. |
| M3 | `overlay-footer.tsx:132-139,170-210` used by `single-panel.tsx:187-204` | After a successful "End now", `setConfirming(false)` runs only on failure. The footer stays mounted in the ended state (`ended` only swaps buttons), so the "End this session?" alertdialog with a live "End now" stays visible beside the "Session ended" card. Test `single-panel.test.tsx:805-838` does not assert it is gone. | `setConfirming(false)` after the call regardless of outcome (or when `ended` becomes true); assert `queryByRole("alertdialog")` is null in that test. |

### SHOULD-FIX

| # | Where | Why | Smallest fix |
|---|---|---|---|
| S1 | `capture-mode.ts:9-12`, `toolbar.tsx:164,170-190`, `use-panel-session.ts:483-485`, `use-auto-mode.ts:275`, `hands-free-controls.tsx:386-419` | "Auto" has two stores: toolbar menu writes `interview-studio.panels.capture-mode.<tenant>` (screen watching), `⌥⇧U` and the web band write `auto-preferred` (listening and watching). Screen watching needs both on (`interval = on && wantsScreen`), so the menu check, the strip and `⌥⇧U` can disagree, and the web band's Manual/Auto means something else. Also default is Auto (`DEFAULT_CAPTURE_MODE`, host default `handsFreeHost()`), design default is Manual; a first run sends screens to the model without a press (privacy-relevant default, product decision needed). | One Auto state (the preference) feeding menu check, strip, `watchScreen`; delete `capture-mode.ts` and the second table; pick the default deliberately. |
| S2 | `use-panel-session.ts:379-384` | `stopAnalysis` sets `stopped` before the call; on failure it only sets a note, so the strip and panes say nothing is running while analysis continues until `localPhase` clears. Also pressing Stop during `"capturing"` flips `stopped` while the capture proceeds. | Reset `stopped` on failure; ignore Stop while `grabbing`. |
| S3 | `overlay-footer.tsx:176-207`, `hands-free-controls.tsx:141-166` | Native ChatPanel has no in-flight guard besides the store (see M1). Web Stop is offered only when a run exists, not during capture/analyze handoff. | Disable input and Send on `answering`; show Stop for `phase !== null`. |
| S4 | `toolbar.tsx:230-244, 154-168`, `popover.tsx:93` | `aria-label` replaces the trigger text, so a screen reader hears "Answer style" / "Capture mode" without the current value; `role="status"` dot nested inside the capture button (`toolbar.tsx:144-151`). | Use `aria-label={`Answer style: ${skill}`}`; move the status text out of the button. |
| S5 | `pairing-panel.tsx:~88-95` | `aria-label="Pairing credential"` on the `<code>` overrides its text, so the revealed value is never announced and the section has the same name. | Drop the `aria-label`, keep `data-testid`; announce reveal via the Show button state. |
| S6 | `task-panels.tsx:76-89`, `hands-free-controls.tsx:191`, `live-session-view.tsx:135` | Same concept computed three ways with different labels ("Task 2" vs "T2"). | Use `taskOrdinal`/`taskLabel`/`selectedTask` everywhere. |
| S7 | `Hotkeys.swift:46-48` (pre-existing, kept) | System-wide Carbon hotkeys include `⌘,`, `⌘⇧C`, `⌘⇧S`, `⌘⇧I`, `⌘⇧V`, which collide with the browser the person is working in (`⌘,` is every app's Settings). Product decision, flagged not blocking. | Register only while Studio is frontmost, or document and offer remapping. |
| S8 | `toolbar.tsx:62-66`, `PresentationController.swift` `setVisible(false)` (inferred) | Red dot hides the window while capture and listening continue; the only indicator is the menu bar item. AGENTS: window stays visibly represented. | Pause listening and Auto on hide, or show a persistent menu-bar recording state; confirm with owner. |

### NIT

| # | Where | Note |
|---|---|---|
| N1 | `use-panel-session.ts:399-401` | Comment claims `grabAndAnalyze` reads refs; it also reads `share.status` from a stale closure. Benign because `share.start()` is idempotent (`use-screen-share.ts:81`), but the comment is wrong. |
| N2 | `use-panel-session.ts:131-134`, `ended-results.tsx:33` | Timers not cleared on unmount. |
| N3 | `ended-retention.tsx` | No focus return after "Keep session data" or confirm collapse. |
| N4 | `session-actions.ts` `solveTask` | Shares the same command key (see M1). |
| N5 | `shared/use-missing-context.ts:55-58` | Dismissal read once per session (`useMemo`); a dismissal from the other surface appears only after reload; no `storage` listener. |
| N6 | `shared/shortcuts.ts` | `Shortcut.id`/`intent` untyped; keys popover lists skill keys when click-through makes them unavailable. |
| N7 | `ended-history.tsx` | `load()` has no cancel; a late page after unmount sets state. |

## 6. Verified good

- Target resolution is one rule in `shared/task-target.ts`; `latestTarget` deleted; follow-up, attach, solve and companion capture all send `{taskId, revision}` of the selected task.
- `sourceSnapshots` exposes only `snap/%` ids (`session-reads.ts:166-185`), spoken ids stay server-side; DB test covers the SQL.
- Native and web share the task card, strip, missing-context strip, skills, clipboard and shortcut tables; D12 held. Keys popover and Swift table have a parity test.
- Honest states: no "listening" claim without a heartbeat, no Reconnect button without a bridge action, ended and tombstone views make no false "nothing is running" claims, device-only disables capture with a reason.
- Cleanup was complete in the areas checked: removed Swift/TS surfaces leave no cross-language strings; negative tests pin the removals.
- Privacy: no content logging in `live/**` or `studio-shell`; private-world fetch; no concealment API (`sharingType` never set).

Not verified: Swift build/tests, live behaviour (click-through, window dots, chat focus), setup-view details for F03/F04, speaker labels.
