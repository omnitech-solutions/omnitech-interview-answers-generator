# Feature A (Native Panel) gap analysis

Paths: SW = apps/studio-shell/Sources/studio-shell, SC = apps/studio-shell/Sources/StudioShellCore, OV = products/interview/src/frontend/studio/live/overlay, PN = OV/panels. Shared = web UI/contracts (PN, packages/interview-contracts); Native = Swift.

## 1. Inventory (A-nn)
Status key: OK = exists and verified in code; P = partial; M = missing; PO = prototype-only fiction.

| ID | Design | Status | Evidence | Must change | Owner | Dependency |
|---|---|---|---|---|---|---|
| A-01 | Split capture button (Analyze screen / Stop, red) + label + ⌘⇧S hint | OK/P | PN/panel-views.tsx:107-128, toolbar-config.ts:79 (icon-only + kbd; label is aria only; no "Analyze screen" text) | Optional visible label | Shared | none |
| A-02 | Auto/Manual menu, Manual default | P | toolbar-config.ts:8-29; capture-mode.ts (per-tenant localStorage, DEFAULT "auto") | Default differs (real Auto). Menu is a native `<select>`, no per-item subtitles | Shared | none |
| A-03 | "Add screen to T{n}" | P | toolbar-config.ts:23 (static label, no T-number); panel-views.tsx:164 | Show task number; show in chat the "added screenshot" line | Shared | task ordinal |
| A-04 | Mic toggle with level bars + ⌥R hint | P | panel-views.tsx:175-185 (icon, no bars, no hint). Native toast "Start/Stop Recording" SC/ShellPrefs.swift:62 | Visual only | Shared | none |
| A-05 | Answer-style dropdown (5 skills) | M (UI) / OK (plumbing) | Toolbar shows read-only `<span class=pn-skill>` panel-views.tsx:186. Picker exists only in SettingsPanel :680-699 and status menu SW/StatusMenu.swift:159-168 | Add dropdown in toolbar; decide list | Shared | none (contract has 9 skills) |
| A-06 | Model chip "Claude · sonnet" | OK | single-panel.tsx:49-59,159 (from LiveAction.generatedBy) | none | Shared | - |
| A-07 | Pane toggles Chat/Answer/Code, width pivot | OK | toolbar-config.ts:36-71; single-panel.tsx:123-154; SW/Presentation/NativeSurface.swift:378-403 (centre pivot, clamped). Icon-only (no labels) | Visual | Shared | setWindowSize exists |
| A-08 | Click-through toggle button + overlay banner "Interact ⌘⇧I" | M (button, banner) / OK (mode) | Mode: SC/PresentationHost.swift:190-193, SC/ShellPrefs.swift:22. No button in toolbar. See bug in A-08b | Add button + banner | Shared+Native | page already reads `presentation.interactionMode` |
| A-08b | (real bug) click-through does not affect the one-window layout | verified bug | NativeSurface.swift:68 `compactWindow().setInteractive(true)` always | Pass `state.interaction.isInteractive`, with the toolbar region excluded or the banner button hit-testable (ignoresMouseEvents is whole-window) | Native | needs hit-test design: whole window ignores mouse, so the "Interact" button in the banner cannot be clicked (prototype's `pointer-events:auto` is not possible) -> ⌘⇧I is the only exit |
| A-09 | Keys popover | M | no keyboard button in PN/*. Status menu lists keys SW/StatusMenu.swift (keyed()) | Build popover from a shared table | Shared | key table (see 2) |
| A-10 | Drag by toolbar | OK | NativeSurface.swift:316-324 ToolbarDragView; isMovableByWindowBackground :266 | none | Native | - |
| A-11 | Status strip: busy stage + elapsed + Stop button | P | Stage line in footer single-panel.tsx:191-202 (phase, "Ns", model). Stop is the capture button, not a strip button | Add Stop to strip (optional) | Shared | none |
| A-12 | Strip states: Paused / Auto watching "next check in Ns" / Finished 22s | M/P | Paused: only footer buttons. Auto line logic exists (OV/auto-line.ts:55) but only rendered in card (hands-free-controls.tsx:82), not in single panel | Render autoLine in strip | Shared | none |
| A-13 | Task chips T1.. + "earlier task" banner | M | Only transcript cards select a task (panel-views.tsx:437-480; use-panel-session.ts:~620 `pinned`). No chips, no "earlier task" tag, no T-ids anywhere in PN | Add chips/tag from `s.selected`, task ordinal | Shared | none |
| A-14 | Chat: speaker labels INTERVIEWER·APP AUDIO / YOU·MIC, times | P | Rows labelled Heard/You/Assistant (panel-model.ts:164-272); transcript has `sourceId` but it is not used | Map sourceId -> label (inferred: engine sourceId distinguishes mic vs app; unverified) | Shared | verify ingest sourceId values |
| A-15 | Capture markers "S1 captured · T1 started", "T1 stopped by you" | M/P | System lines only ("Analysis stopped." use-panel-session.ts:~335) | Add marker rows | Shared | - |
| A-16 | Answer/Code cards in chat ("Answer ready", "Code ready · n of n tests passed") | M (replaced) | One assistant row per task, replaced in place (panel-model.ts:239-260) -- deliberate "one thread per task" | Keep real; optional ready-cards | Shared | - |
| A-17 | Listening indicator + interim speech | OK | panel-views.tsx:514-521,571-578 (`s.live.interim`) | none | Shared | - |
| A-18 | Follow-up input: pending + reply, "Add context to T{n}" | P | Input OK :584-612; no pending row; placeholder generic (:60). **Follow-up always targets newest task, not the selected one**: session-owner-input.ts:41-50,138 (`latestTarget`) | Target `selected` task; pending row | Shared (+frontend client only; contract already has `target`) | none |
| A-19 | Answer pane: steps list (Capturing/Reading/Drafting) with per-step time + checks | P | Single spinner line (panel-views.tsx:237-250) | Build steps from phaseLabel keys | Shared | per-step timing not exposed (inferred) |
| A-20 | Stopped-early card "You stopped this analysis. Nothing was published" | M | no text; stop hides phase (use-panel-session.ts:~327-335) | add | Shared | - |
| A-21 | Constraint chips / sections (Approach, Brute force, Optimal, Say out loud) | OK (different shape) | panel-model.ts:132-159: Constraints, I/O, Naive, Optimal, Complexity; no "Say out loud" section | decide whether to add | Shared | answer schema |
| A-22 | Copy answer / Copy code | M | code-card.tsx has no copy; no copy button anywhere in PN (grep) | add via `navigator.clipboard` (page) -- no bridge needed | Shared | - |
| A-23 | Code pane header (language), badges Generated / n/n generated tests / Not fully verified | M in panel, OK elsewhere | Data exists: coding-panel/session-results.ts:62-97 (`testsPassed`, `fullyVerified`, `tests.passed/total`). Native CodeCard shows only language head (code-card.tsx:34) | Reuse session-results states in code pane header | Shared | none; keep "not fully verified" honest (never claim verified unless `fullyVerified`) |
| A-24 | Code pane placeholders (Waits / Writing code… Ns / Stopped before code) | P | panel-views.tsx:362-369 "Code appears here when ready" / "No code yet" | wording+timer | Shared | - |
| A-25 | Pause/Resume + dot + clock + End w/ inline confirm | OK | footerButtons toolbar-config.ts:112-162; Footer overlay-footer.tsx:91-213 (confirm incl. Escape, focus). No running clock/dot in footer | add clock | Shared | - |
| A-26 | Ended card (stats: utterances/tasks/answers/code drafts), Open summary, Start new session | P | Footer shows "Start a new session" only (toolbar-config.ts:122-134). No ended card, no stats, no Open summary; panes keep showing. Ended view exists on web (live/ended-view.tsx, ended-summary.ts) | Add card + `openExternal` to ended page URL (bridge `openExternal` exists SC/HostBridge.swift:67) | Shared | stats from snapshot counts (content-free) |
| A-27 | Footer honesty: "Visible window · shows in screen shares" + build | OK (better) | overlay-footer.tsx:136-145 | keep | - | - |
| A-28 | Toasts (large, bottom-left) | OK (better) | Native toasts SW/NativeSurface.swift:96-100; ShellPrefs.swift:72-81 | keep | Native | - |
| A-29 | Empty state "Nothing analysed yet" + button | P | text only "Press ⌘⇧S to analyze the screen" panel-views.tsx:251-253 | add button | Shared | - |
| A-30 | Window width floors (720), centre placement | P | BARE_WIDTH 540 (toolbar-config.ts:55); NativeSurface min 320x360 | visual | Shared | - |

## 2. Shortcuts (design keys popover)
All are already registered in Swift via Carbon (SC/Hotkeys.swift:42-69, HotkeyCenter.swift). Mapping (SC/Hotkeys.swift:98-122, bridge intents SC/HostBridge.swift:27-58):

| Key | Registered | Maps to | Gap |
|---|---|---|---|
| ⌘⇧S | yes :43 | intent capture.analyze (page: stop if running, use-panel-session.ts `press`) | none. Fires a "Current Skill" toast on every capture (Hotkeys.swift:91): noisy, not in design |
| ⌥R | yes :44 | intent transcribe.toggle | none |
| ⌘⇧I | yes :45 | present toggleInteractionMode | does nothing to compact window (A-08b) |
| ⌘⇧V | yes :46 | present togglePanelsVisible | OK |
| ⌘⇧C | yes :47 | present focusPanel(.chat) | **wrong for one-window**: focusPanel forces layout=.panels and minified (PresentationHost.swift:160-165), leaving the compact window. Needs a "focus chat input" intent (page already has FOCUS_INPUT_EVENT, panel-views.tsx:56) |
| ⌘↑/⌘↓ | yes :49-50, only registered while interactive | intent skill.prev/next | works only with interaction ON; see skill wiring below |
| ⌥⇧U | yes :55 (alias, Option+Shift) | intent auto.toggle | OK; in-page key differs (Alt+Shift+H, commands.ts:50) |
| ⌘, | yes :51 | present openPanel(.settings) | same layout-flip problem as ⌘⇧C; settings is a separate multi-panel window, not in the one window |
| (extra, not in design) ⌘⇧\ clear, ⌥⇧G, ⌥⇧M, ⌥⇧T, ⌃⌥+arrows move, ⌃⌥⇧+arrows resize | yes | | resize keys target `.analysis` panel kind, a no-op in compact layout (NativeSurface.swift:122-123 guard on `panels[kind]`); move keys only move `panels`, not compact (:115-120). Candidates to retarget |

In-page Alt keys (commands.ts:34-91) are a second keymap: Alt+Shift+S = "generate solution" there but ⌘⇧S = capture natively (same physical letter, different meaning).

Skill (OwnerSkill) wiring: UI -> bridge -> server -> prompt is wired EXCEPT the toolbar UI.
- Page state: `prefs.settings.skill` in localStorage (OV/capture-prefs.ts:18,66-77), default DSA (commands.ts:149).
- Sent: use-hands-free.ts:131-133 `hints.skill` ("auto" if unset) -> session-client.ts:312 form field `skill`; typed follow-up via submitFollowUp(text, hints) (use-panel-session.ts send; session-owner-input.ts:137-146).
- Server: session-run.ts:652,1085-1104 (sticky, newest wins, "auto" resets) -> assist-stage.ts:727 `SKILL_POLICY[skill]` (constant sentence per skill, :394-411). So end-to-end works; stops only at the missing toolbar dropdown.
- Swift: OwnerSkill (9 values, mirrors contract; SC/OwnerSkill.swift) persisted separately in UserDefaults (SC/ShellPrefs.swift:112) and cycled independently (AppDelegate.swift:169-170). **Two sources of truth**: shell toast text comes from the Swift copy, the answer uses the page copy; they drift if an intent is missed (page not loaded, `claimCommand` dedupe, or interaction off in page). The comment "pushes ... skill" (SW/StudioWebView.swift:16) is stale: pageFinished (AppDelegate.swift:~205) pushes only presentation + screen-watch status.
- Design lists 5 styles (DSA, System Design, Behavioral, Frontend, Debugging); contract has 9 and no Frontend/Debugging. Adding those needs a contract change plus SKILL_POLICY entries (assist-stage.ts:394) and Swift enum mirror.
- Language: contract supports only typescript/react (live-session.ts LIVE_OWNER_LANGUAGES); the design's C++ stub is fiction.

## 3. Visual vs behavioural; better-than-prototype; privacy conflicts
Purely visual: A-01 label, A-04 level bars, A-07 labels, A-29 button, A-30 widths, blur (real turns the blur layer OFF: NativeSurface.swift:407 `setOpacity` always sets alpha 0 -> the Opacity menu and PresentationState.opacity are inert: dead feature), card shapes in chat.
Behavioural: A-05, A-08/08b, A-09, A-12, A-13, A-18 (target selected task), A-20, A-22, A-23, A-26, ⌘⇧C/⌘, semantics.

Real behaviour better than prototype (do not regress):
- Stop is server-scoped and fenced: session.control `stop-work` abandons every in-flight dispatch, stored as `owner_stopped`, replay-safe (session-run.ts:742-750, 610-640). Prototype's per-task stop is a local flag.
- End confirm has focus management/Escape (overlay-footer.tsx:118-120,178-184); Pause/End disabled while pending.
- Honest visibility footer + native toasts; consent gate (AppDelegate requireConsent); capture refuses non-browser app (use-panel-session.ts:~205 message); Auto bounded: 8 s default, 3-30 s clamp, change threshold, 120/session (auto-interval.ts:11-13, auto-gate.ts:5).
- Never-invisible clamp (PanelOpacity), no `sharingType` concealment (NativeSurface.swift:11).
- Follow-latest transcript with "N new" jump (follow-latest.ts).
- Verification honesty: separate Generated / tests passed / fully verified facts (session-results.ts:1-5,62-63); the prototype's hard-coded "n/n generated tests" must not be shown unless the server reports it.
- Missing-context strip with Add screenshot / Add context / Looks complete (panel-views.tsx:264-304) has no prototype counterpart.

Prototype behaviour that contradicts our rules (and the safer resolution):
1. "Stop this analysis" implies per-task cancel; real stop cancels all running work. Label it "Stop work" or keep session-wide and say so.
2. Click-through overlay with clickable "Interact" button (pointer-events:auto) is impossible with ignoresMouseEvents; keep ⌘⇧I as the only exit and show a non-interactive hint. Also fix A-08b first.
3. Prototype ended state wipes panes and says "Nothing was submitted or typed for you". Keep the honest text; on end, keep read-only access to last answer until the person starts a new one (it is their own content; nothing logged).
4. Footer shows commit hash "a482109+": keep BUILD_ID, never show content.
5. Prototype stats "utterances/answers" are counts only; fine, but compute from snapshot in-memory, never log or send (AGENTS rule 8).
6. Auto strip "only while a browser is in front" matches real gate; keep device-side hashing (frames never leave device when unchanged).
7. Chat speaker text "INTERVIEWER" is an assertion about identity; derive from capture source only.
8. Toast "Current Skill ..." on every capture and "Interaction Mode" copy exist in native code; harmless but noisy.

## 4. Duplicated / superseded / possibly dead (candidates, not verified by usage tests)
- SC/PresentationHost.swift:18-25 + NativeSurface multi-panel path (`panels[kind]`, PanelKind pill/analysis/chat windows, layout presets reading/all, StatusMenu layout menu, Hotkeys move/resize keys): superseded by the default compact one-window layout (ShellPrefs.swift:130 default .compact). Keep only if multi-window stays a supported mode.
- NativeSurface.swift:407 `setOpacity` -> alpha 0 always; Opacity menu (StatusMenu.swift:~148-158), `PresentationCommand.setOpacity`, `PanelOpacity`, prefs.opacity: no visible effect.
- PN/panel-views.tsx `PillPanel` multi-window variants, `AnalysisPanel part="all"`, panels-root.tsx PiP branch (:174-191) + pip-adapter.ts: second presentation of the same panels alongside SinglePanel.
- Whole card stack in OV (overlay-card.tsx, command-bar.tsx, hands-free-controls.tsx, session-switcher.tsx, overlay-footer FollowUp:40-89, `Footer controls=false`) is a parallel UI for the same session; PN reuses only Footer, failureNote, loadMask etc. Confirm it is still routed in overlay-page.tsx before touching.
- Two keymaps for the same commands (PN/commands.ts:34-91 Alt keys vs Swift Hotkeys.swift Cmd chords) and two skill stores (localStorage vs UserDefaults).
- Hotkeys.swift:91 toast on capture; Swift `HotkeyRouting.nudge/resize` for `.analysis` only.
- Stale comment StudioWebView.swift:16.
- toolbar-config.ts PANES id "analysis" vs design "answer" (naming only).

## 5. Work packages (native-side first; contract changes flagged)
WP0 (no dependencies, Swift only; small): fix A-08b (pass interaction to compact window; design hit-testing), fix ⌘⇧C / ⌘, to not flip the layout in compact mode (new typed `HostCommand.focusChat` / settings handled inside the one window), retarget move/resize keys to the compact window, remove capture "Current Skill" toast. Files: SC/PresentationHost.swift, SC/Hotkeys.swift, SC/HostBridge.swift, SW/Presentation/NativeSurface.swift, SW/AppDelegate.swift, Tests/StudioShellTests/PresentationTests.swift.
WP1 (skill single source of truth): make the page the owner of skill; the shell either reads it (new `skillChanged` page->shell call) or only sends `skill.set:` intents. Remove Swift cycling in AppDelegate.swift:169-170. Files: SC/OwnerSkill.swift, SC/ShellPrefs.swift:112, AppDelegate.swift, StatusMenu.swift; page side PN/use-panel-session.ts. Needs a bridge method name added to HostCallDecoder allow-list (SC/HostBridge.swift:99-104).
WP2 (Shared UI, native-independent): toolbar skill dropdown, keys popover, click-through button+banner, task chips + earlier-task tag, strip (auto line, pause, stop), steps list, stopped-early card, copy answer/code, code badges (reuse session-results states), ended card + stats, "Add screen to T{n}", follow-up targets selected task. Files: PN/panel-views.tsx, single-panel.tsx, toolbar-config.ts, panel-model.ts, panels.css, session-owner-input.ts (target). Shared contract change needed first: none for these; skill list change (Frontend, Debugging) needs `LIVE_OWNER_SKILLS`, `LIVE_OWNER_SKILL_LABELS`, `SKILL_POLICY` (assist-stage.ts:394), Swift OwnerSkill mirror, and BridgeDecode tests.
WP3 (Open summary): `openExternal` already exists; only needs the ended URL (OV/studio-links.ts) from the page. No Swift change expected.
WP4 (cleanup, after WP0-2): decide multi-panel mode fate (delete or keep), remove dead opacity, unify keymaps, fix stale comments.
Ownership rule: WP0/WP1 touch only apps/studio-shell; WP2/WP3 only products/interview frontend; only the skill-list extension crosses into packages/interview-contracts and backend. Dependency order: WP0 and WP2 can run in parallel; WP1 before any skill UI work that persists the value; contract change before WP2's extra skills.
