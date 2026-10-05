# Feature B (Live Session Web) gap analysis
Paths relative to products/interview/src/frontend/studio/live (FE) and products/interview/src/backend/live-session (BE). Inferences marked (inf).
Status: V = existing and verified in code, P = partial, M = missing, PO = prototype-only (do not build as drawn).
Shared = needs packages/interview-contracts or backend change; Web = FE only.

## 1. Inventory
| ID | Design behaviour | St | Evidence / required change | Owner | API/data |
|---|---|---|---|---|---|
| B-01 | Nav "Live session" item + live red dot | P | config/views.tsx:126 item exists (key L). No live dot: ../sidebar.tsx:138 dot is for questions only. Add dot from useLiveSession model.phase==="open" | Web | store |
| B-02 | Target: Rehearsal vs linked interview cards | V | setup-sections.tsx:60-150, setup-model.ts:15-20,107-113. Candidacy-without-interview card also exists (design has none) | Web | GET /sessions/choices |
| B-03 | Consent gate, start disabled with reason | P | setup-view.tsx:141-147,202-216; footer reason text is next to buttons, not a sticky footer. Design shows consent only for linked target; real UI requires it for rehearsal too (buildStartRequest setup-model.ts:95) - keep (safer) | Web | none: no consent field in start schema (interview-contracts live-session.ts:126) |
| B-04 | Start validation | V | setup-model.ts:90-121, startErrorMessage :135 (fixed sentence per code) | Web | POST /sessions |
| B-05 | Host cards Mac app vs "This browser only" with capability list/status | M | No host selector in setup-view.tsx. Host is implied by window.studioHost (host-adapter.ts:23-30). Capability copy exists in a different shape: CompanionReport setup-view.tsx:375, SOURCES :51 | Web (+ native for "Start in Mac app" handoff) | negotiateStudioHost; GET /companion-capability |
| B-06 | Browser warning "can't hear app audio" | P | Advisory exists only when assistance on and no app-audio source: setup-view.tsx:263-274; sources-tab.tsx:54 WITHOUT_COMPANION | Web | none |
| B-07 | Sources as capture scope | V (design drops the switches) | setup-view.tsx:229-248 three SwitchRows. Design derives sources from host. Keep switches (server requires 1-3 sources, schema :128) or derive defaults from host | Web | start body |
| B-08 | Matrix selector (rev N, none) | V | setup-sections.tsx:152-205, setup-model.ts:68-85,114-119; pins revision. Design label "My matrix - rev 3" vs real "name - latest (revision N, M roles)" | Web | choices.profiles |
| B-09 | Grounded claims | V | claim-chips.tsx, answer-body.tsx:140-178 ("Checked against matrix revision N", claim chips) | Web | action result |
| B-10 | Where AI runs: Allow remote / Device only + copy | V | setup-sections.tsx:207-289 (Segmented + POLICY_COPY). DUPLICATED by second control setup-view.tsx:347-369 (see section 4) | Web | start body |
| B-11 | Device-only warning (no screenshot analysis, no code, no silent remote fallback) | V UI; enforcement V server-side | UI: setup-view.tsx:364-368, device-only-notice.tsx. Server: ADR-0012 rules device-only-enforced-twice / stage-without-device-refused; gateway refusal at resolution + before dispatch (session-dispatch.ts:13, coding-path.ts:181,219,264); coding stage lists only remote profile (coding-stage.ts:17); capture-request refuses early (capture-request.ts:242); tighten cancels queued jobs and aborts in-flight remote slots (repository.ts:541, processor.ts:288-301); fenced-writes.ts:606,654. Web copy deliberately says screenshots are "stored, never sent" (capability-table.tsx:25-26) | - | none missing |
| B-12 | Retention Delete-at-end / 30 days / Until I delete | V | setup-sections.tsx:291-341, labels ended-summary.ts:51-55 identical to design | Web | start body |
| B-13 | One-way shorten (setup note + live + ended) | V | sources-tab.tsx:299-317, ended-retention.tsx:92-105, BE repository.ts:548-569 (retention_lengthening_refused), DB trigger ADR-0012 | Web | POST /retention |
| B-14 | Start buttons, footer "Ready" summary | P | setup-view.tsx:323-346 two buttons (Start hands-free / Start session) plus ad hoc policy buttons; design one footer with host-specific label | Web | - |
| B-15 | Live header: state pill + clock | V | session-bar.tsx:146-161, session-bar-model.ts:44-80; clock is server clock (model.elapsedLabel). Prototype clock is local timer (PO) | Web | stream |
| B-16 | Source health icons (mic, app audio, screen) | V | session-bar.tsx:163-188 chips with title/aria; only shown when companion contact (companionLine). Design shows red icon on gap | Web | stream, heartbeat |
| B-17 | Locality chip | V | session-bar.tsx:200-217, session-banners.ts:213-232. Real label "On this Mac only" is asserted for any host; "Remote allowed" vs design "Remote - Claude" | Web | session.processingPolicy |
| B-18 | Pop out | P | session-bar.tsx:221-241 two buttons: Card view (in-page) and Float; design has one "Pop out" (PiP/native window). Handoff text "Controls are in the floating window" exists via hands-free-context | Web | presentation store |
| B-19 | Pause / Resume | V | session-bar.tsx:82-112,253-264 incl. renew-then-resume for credential_renewal_required | Web | POST /control |
| B-20 | End + confirm popover | V | session-bar.tsx:265-286, end-confirm.tsx. Design copy "This also ends it in the Mac app": check end-confirm.tsx copy (not read) | Web | POST /control end |
| B-21 | Banner: paused (Resume) | V | session-banners.ts:75, banner-copy.ts "paused" | Web | - |
| B-22 | Banner: app-audio gap/lost with Reconnect / Pair companion | P | Banners exist for lost/gap/permission/credential (session-banners.ts:77-107) but CTA is only Open Sources/Renew/Resume (banner-copy.ts:21-27). No "Reconnect" (native) and no "Pair companion" CTA that opens the credential panel | Web (+ native bridge for Reconnect, inf) | heartbeat, bridge |
| B-23 | Capture card with Manual/Auto and Analyze/Stop | P | Web: HandsFreeBand (live-session-view.tsx:53; overlay/hands-free-controls.tsx) has Capture & analyze, Auto toggle, share stop. "Stop" in web stops the SHARE (hands-free-controls.tsx:~151 onStop=share.stop), not the analysis. Control stop-work is wired only in native panels (overlay/panels/use-panel-session.ts:365; actions.stopWork session-actions.ts:242) | Web | POST /control stop-work (exists) |
| B-24 | Task chips + "Viewing earlier task / Back to now" | V | task-panels.tsx:66-95, live-session-view.tsx:174-188. Copy differs slightly | Web | - |
| B-25 | Listening empty state | P | task-panels.tsx:28-41 IdleState says "Ready - share a window and press Capture & analyze..." (design: "Listening - spoken questions answered automatically") ; copy follows activity key | Web | - |
| B-26 | Task header: type pill, meta (T/rev, screenshot S#, host) | P | pill + "Task rev N" only (task-panels.tsx:121-127). No T number in header (aria only), no screenshot provenance, no host. Provenance exists in action row source_event_ids (owner-input.ts:snapshotProvenanceId) but is not in TaskView (session-tasks.ts) | Shared (expose snapshot ordinal/label) + Web | action.sourceEventIds |
| B-27 | Constraints chips | V | coding-panel.tsx:15-44 (with superseded state, richer than design); shown for coding tasks only | Web | - |
| B-28 | Three stage tiles Answer / Code / Fully verified | M (as tiles) | Coding panel has a Status dl Generated / Tests passed / Fully verified (coding-panel.tsx:52-121) with reasons; no Answer stage tile, no per-stage progress/timers. Distinctness of generated vs tests-passed vs fully-verified IS preserved and server-owned (code-states.ts) | Web | runs + code.states |
| B-29 | Answer / Code tabs | M | One panel per kind: task-panels.tsx:129-143 chooses CodingPanel OR AnswerBody. For a programming challenge answer.draft and codingBrief.restatement are parsed (session-results.ts:63,74) but never rendered (inf from grep: codingBrief only read for language, coding-panel.tsx:151) | Web | existing data |
| B-30 | Coding "Answer" sections APPROACH / BRUTE FORCE / OPTIMAL / SAY OUT LOUD | M, no data | Backend brief is {language, restatement, constraints[]} only (session-results.ts:63). No approach/complexity fields. Design content needs a stage/contract change or must be dropped | Shared (contract + coding stage) | new fields |
| B-31 | Copy answer / Copy code | P | Copy answer V (answer-body.tsx:147-154, toast live-session-view.tsx:136-144). Copy code: LiveCodeCanvas (overlay/code-canvas.tsx) - verify it has Copy (not read) | Web | - |
| B-32 | Open in Workspace; edits never overwritten | V | coding-panel.tsx:202-215, workspace-handoff.tsx; held result "Your edits are kept" coding-panel.tsx:193-201 (server held-result logic, fenced-writes/session-drafts) | Web | draft routes |
| B-33 | Follow-up input that really sends | P | Sends: session-actions.ts:343-352, session-owner-input.ts:150-160, route POST /input. Placeholder says target label (hands-free-controls.tsx:~190) but target = NEWEST action, `latestTarget` (session-owner-input.ts:48-56), NOT the task being viewed/pinned. Server supports any target {taskId,revision} (live-session.ts:266-300, session-run.ts:690-735) | Web | POST /input target |
| B-34 | Model label "Claude - sonnet - general knowledge" | P | generatedBy only used in native single panel (overlay/panels/single-panel.tsx:49-115); web page has none; contract has liveGeneratedBySchema (live-session.ts:502) | Web | action.generatedBy |
| B-35 | Side tabs Transcript / Activity / Sources (+ red dot on Sources) | P | session-tabs.tsx, transcript-tab.tsx, activity-tab.tsx, sources-tab.tsx. Tabs are below the main column, not a right side panel; no alert dot on Sources (grep) | Web | stream |
| B-36 | Transcript rows with source tags + Gap row + "S1 analysed -> T1 started" row | P | transcript-tab.tsx/session-transcript.ts include gaps (inf); screenshot->task row not verified | Web | observations |
| B-37 | Activity rows with profile + remote allowed, results of outdated rev never published | V | activity-tab.tsx:13-60, session-runs.ts profile label | Web | actions |
| B-38 | Sources rows + status + "Pair capture companion" action | V/P | sources-tab.tsx:246-277 health rows; CTA is the inline panel (always rendered), not a button-revealed card | Web | stream |
| B-39 | Pairing credential: show/hide/copy | V | pairing-panel.tsx:65-97 (masked, memory-only, never storage) | Web | credential response |
| B-40 | 2 h expiry shown | V | CREDENTIAL_LIFETIME_TEXT (session-sources.ts:211) from ACTIVE_SESSION_LIMITS 2h (active-session-contracts limits.ts:31); real expiry time shown pairing-panel.tsx:99-103; server clamps to session cap (session-credential.ts:20) | Web | - |
| B-41 | Scope text (observe + pause only) | V | sources-tab.tsx:211-216, text matches ADR-0013 (pause on capturing:false) | Web | - |
| B-42 | Revoke | V | pairing-panel.tsx:120-147 "Revoke and pause" with confirm; BE repository.ts:496-511 revokes AND pauses an active session | Web | DELETE /credential |
| B-43 | "Where each step runs" | V | capability-table.tsx (policy and speech-aware rows) in Sources tab | Web | - |
| B-44 | "Switch to this Mac only (can't undo)" | V | sources-tab.tsx:289-296 ConfirmAction; BE repository.ts:515-544 (loosening_refused, cancels remote jobs) | Web | POST /policy |
| B-45 | Ended view: stats, items, retention line, delete confirm, purging, tombstone, start another, history | V | ended-view.tsx, ended-retention.tsx (confirm :113-139, purging :108-112, retry :170), ended-history.tsx (paged 10, cursor), tombstone :125-159. Tombstone fact in design "1 task" is not available (real: started, ended, hints counted; no task count) | Web | GET /sessions |
| B-46 | Ended items list ("Answer - Copy it from session history", "Workspace draft - 5/5 tests") | P | ended-results.tsx (answerRows/codingRows in ended-summary.ts). Design promise "Copy from session history" - check history opens summaries only (ended-history.tsx header: no content from list route) | Web | - |

## 2. Prototype vs contract conflicts and safer resolution
1. Static pairing code `K7QF-29XM-PL4D` (script `side.cred`): real credential is `asc_` + 43 base64url, 256 bits, plaintext returned once by POST/start/renew (credential.ts:33-41, session-credential.ts). Never render a static or reconstructible value; keep the current masked, memory-only panel (pairing-panel.tsx).
2. Prototype "Shown once" but offers Show/Hide after reload-less state: real panel loses value on dismiss/reload (store only). Keep; renew is the recovery path (pairing-panel.tsx:105-110).
3. Revoke also pausing + toast "Code revoked, session paused": matches BE (repository.ts:506-507) only when status is active. Resolution: read the returned session state, not assume; toast must derive from refreshed status. Revoke on paused session does NOT pause (no-op transition).
4. Consent line "Your answer isn't stored": real start request has no consent field, so server cannot attest it. Current copy "Studio asks on this screen and does not store your answer" (setup-view.tsx:211-213) is accurate. Do not imply an auditable consent record; if one is wanted that needs a new contract field and ADR (inf: not planned).
5. Toast "Mac app is listening - floating window opened" on start: prototype claim without evidence. Real flow: web start does not talk to the native app. Resolution: say "Session started" and show listening only after server contact/heartbeat (session-bar-model companionLine already refuses "connected" without recorded contact).
6. Timer-based delete (2.4 s setTimeout then "deleted"): real purge is async worker sweep; UI must re-read until `purged` (matrix 3.6: re-read every 3 s up to 20 times) and handle purge_incomplete (ended-retention.tsx:20-23, 170). Tombstone facts must come from the session row.
7. Fixed counts and model label ("2 utterances", "Claude - sonnet", "5 of 5 generated tests passed"): derive from model.stats / action.generatedBy / code.tests. "Fully verified: Not established" must come from states.fullyVerified (coding-panel.tsx:64), never be hard-coded, but the design's wording is acceptable when states say false.
8. Synthetic task timing ("Drafting... 6 s", stage seconds): remove; use run state + server time.
9. Device-only "Everything stays on this Mac" (loc note): too strong. Speech is on-device in both modes only per the companion's own report; answer drafts use the device model; screenshots are still STORED server-side in device-only. Keep capability-table.tsx wording ("Stored for you; never sent to a model").
10. Design "Switch to this Mac only" button always visible when remote; real canTighten requires open session (session-banners.ts:230). Same.
11. Prototype `taskAt` single task; "Stop" sets taskAt null (discards). Real stop-work keeps session active and settles revisions; new analyze opens a new task (repository.ts:398-434). Do not delete task UI on Stop.
12. Design Pause from header while "Reconnect" toggles gap locally: prototype only. Reconnect must be a bridge/native action, not a store flag.
13. Prototype "Delete session data" shown in `alive` only; real also in purging and with retention "Delete at end" worker purge text. Keep real copy.
14. Credential "can't add sources, resume, end or delete": consistent with ADR-0013 (it pauses via heartbeat). Not a conflict.

## 3. Backend/API support
- Follow-up target: server accepts target {taskId, revision}; stale-solve guard only for solve (session-run.ts:697-704); a follow-up to an older revision revises (reason follow_up) (inf, line 731-733). Web client always sends newest action (session-owner-input.ts:148-160). Change = FE: pass selected task's {taskId, currentRevision}. No backend change.
- Earlier-task context: nothing needed server-side; stream already returns all actions. Missing only FE label.
- Policy tighten: V (POST /policy, refuses loosening via both route and DB trigger; cancels jobs).
- Retention shorten: V.
- Credential issue/renew/revoke: V. Restrictions: scope enforced by ingest (companion cannot write owner.input; ingest.ts namespace refusal) and ADR-0012. Resume with dead credential gives credential_renewal_required (repository.ts:366-380).
- stop-work: V (POST /control, status_refused if not active).
- Delete/purge: DELETE /sessions/:id returns 202 + view (routes.ts:602-609); worker purge (session-purge.ts) sets purged_at, purge_outcome, counts; view exposes purged, purgeOutcome, shownDraftCount, endedAt, createdAt. NOT exposed: task count, screenshot count after purge (design tombstone "1 task"). Needs contract change if wanted (Shared) or drop the fact.
- Session history: V (GET /sessions list, summaries, cursor; liveSessionSummarySchema live-session.ts:82-96). No title/target name in summary (only ids), so history rows say "Interview"/"Rehearsal" (ended-history.tsx:14-19). Names need a contract field.
- Screenshot provenance "from screenshot S1": ids in action source_event_ids; ordinal S# not exposed (Shared).
- Host card state ("Installed" for Mac app): no API; only window.studioHost presence when already inside native shell. A plain browser cannot know the Mac app is installed (inf). Resolution: show "Open in Mac app" only with a deep link, otherwise show capabilities statically.
- Coding approach/complexity sections: no data (B-30).
- Consent record: none (B-03).

## 4. Duplicated / superseded / possibly dead
- setup-view.tsx:347-369 "start-choice" Hands-free allow-remote/device-only buttons duplicate ProcessingSection (setup-sections.tsx:216-289); both write form.policy. Fold into the single section (superseded).
- setup-view.tsx:375-433 CompanionReport vs sources-tab.tsx:126-158 CompanionReport: two components, same name, same data source (useCompanionCapability); candidate to share one presenter.
- setup-view.tsx:218-227 "Capture companion" section copy duplicates sources-tab.tsx:211-216 credential-scope copy.
- session-bar.tsx source chips vs overlay/source-popover.tsx and sources-tab HEALTH table (sources-tab.tsx:41-49): three renderings of SourceHealth.
- Card view + Float buttons (session-bar.tsx:221-241) vs overlay presentation modes: design collapses to one Pop out.
- live-view-kit.tsx and live-scenarios.ts, live-script-kit.ts, setup-capability-fixtures.ts, session-fixtures.ts, session-result-fixtures.ts, live-draft-link.ts: no non-test importers except chain among themselves/tests (grep): test-support, keep but not product code.
- overlay/auto-change.ts: only imported by its own test (matrix 6 also notes ADR-0022 mismatch: ADR says 30/session, code 120).
- hands-free-choice.ts: two readers (setup-view.tsx, device-only-notice.tsx), localStorage key hands-free-policy; fine, but the setup copy on remembered policy overrides the "Allow remote" default silently (setup-view.tsx:99-101): surface it.
- Not verified dead: companion-setup.tsx (used by overlay-card.tsx), float-access.ts (used).

## 5. Recommended web-side work packages
Prerequisite shared-contract changes first (small, additive, in packages/interview-contracts/src/live-session.ts and backend live-session routes/mapping):
 S1. Optional `ordinal`/label for screenshot snapshots exposed on stream observations or action provenance (B-26).
 S2. Optional target title and task count on LiveSessionSummary / tombstone (B-45, history).
 S3. (Decision needed, ADR) coding brief fields approach/brute force/optimal/complexity/say-aloud (B-30) - otherwise drop from the web design.
 S4. None needed for follow-up target, stop-work, policy, retention, credential.

Web packages (ownership by file group; each is FE-only unless noted):
 W1 Setup restructure (setup-view.tsx, setup-sections.tsx, setup-model.ts, use-setup-choices.ts, setup.css): numbered sections, host cards from studioHostInfo() + capability list, remove duplicate policy buttons, sticky footer with reason. Keep consent for all targets. Tests: setup-view.test.tsx, setup-model.test.ts.
 W2 Live header and banners (session-bar*.tsx/.ts, banner-copy.ts, session-banner-list.tsx, session-banners.ts): single Pop out, Pair-companion CTA that reveals the pairing panel, host-aware Reconnect (needs native bridge: coordinate with native owner), dot on Sources tab and nav item (config/views.tsx + sidebar.tsx).
 W3 Task card (task-panels.tsx, coding-panel.tsx, answer-body.tsx, session-tasks.ts, code-canvas.tsx): header meta (T#, rev, host, S# once S1 lands), 3 stage tiles, Answer/Code tabs rendering answer.draft and codingBrief.restatement, model chip from generatedBy, keep Status honesty. Depends S1; S3 optional.
 W4 Follow-up target (session-owner-input.ts, hands-free-controls.tsx, live-session-view.tsx): pass the viewed task's {taskId, currentRevision}; label "Add context to T{n}". Pure FE, small.
 W5 Capture card Stop semantics (hands-free-controls.tsx, use-hands-free.ts): wire actions.stopWork when phase is set (pattern in overlay/panels/use-panel-session.ts:365); keep "Stop sharing" separate.
 W6 Side panel layout and Sources (live-session-view.tsx, session-tabs.tsx/.css, sources-tab.tsx, pairing-panel.tsx): right rail at wide widths; credential shown only after explicit "Pair companion"; keep memory-only.
 W7 Ended view polish (ended-*.tsx): tombstone facts; depends S2.
Boundaries: W1, W2/W6, W3/W4/W5, W7 touch disjoint files except live-session-view.tsx (W2, W4, W6: serialize) and session-state/session-tasks models (W3 only). Shared `packages/*` edits only through S1-S3 by one owner. Native owner unaffected except W2 Reconnect.
