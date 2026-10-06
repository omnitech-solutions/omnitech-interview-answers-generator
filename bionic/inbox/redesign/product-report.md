# PRODUCT package report (final-report items 1, 3, 4, 11d, ADR-0007 repair)

Nothing committed. Everything below was run in this checkout; counts are from the runs.

## 1. F-OWNER (item 1): DONE
- A native owner now says so over the panel bus: `PanelState.native?: true` (`live/overlay/panels/panel-bus.ts`), set by the native window's `usePanelSession` while it owns (`panels/use-panel-session.ts`, `nativeCaptureAvailable()`).
- The web mirror (`live/overlay/hands-free-controls.tsx`): Auto line "Auto · running in the Interview Studio app"; share line and the Capture & analyze title "The Interview Studio app owns capture. Capture from the app."; the button is disabled (still visible and readable). No "No source shared" wording for a native owner. A browser owner in another window keeps the old wording.
- Failing test first: `hands-free-band.test.tsx` ("says the Interview Studio app owns capture ...") failed, then passed.
- `e2e/live-session/tests/cross-surface-sync.spec.ts`: the `test.fail` is gone, the spec is a normal passing test (WebKit, passed). New claims row `web.hf.capture-analyze-native-owner` (covered).
- Edits in files I do not own (small, targeted): `overlay/hands-free-controls.tsx`, `overlay/panels/panel-bus.ts`, `overlay/panels/use-panel-session.ts` (native worker's tree).

## 2. Item 3, no-question stale "Drafting an answer": candidate EXPOSED a stale outcome, fixed; root cause of the 1.5% flake still UNVERIFIED
- New `live/session-merge.test.ts` (4 tests). The tie candidate was real: with the same `updatedAt`, an in_flight copy arriving AFTER the succeeded copy replaced it (later row wins), restoring "Drafting". Failing test first (1 of 4 failed), then fixed in `live/session-merge.ts`: on an exact tie an `in_flight` copy never replaces a final one; every other order is unchanged.
- The "late backend flag" candidate (noQuestion arriving after the pending task registers) was NOT tested; the flake was never reproduced, so I cannot claim this is the cause. It is a proven stale-state path that is now closed.

## 3. Item 4 / F8: web declined share -> capture-problem banner: DONE; claims 28 -> 5 pending
- `use-screen-share.ts` no longer holds ad-hoc strings: it exposes `problem` (a closed reason: share-cancelled, share-unsupported, share-failed, source-lost for the browser's own Stop sharing). `use-hands-free.ts` shows it through the existing `useCaptureProblem` (shared `capture-problem` table, nothing duplicated); starting a share clears a share-caused banner (only at the moment the share begins, so a capture failure is not wiped). `HandsFreeNote`/`BandView` no longer read `share.message`.
- Tests: `capture-ui.test.tsx` (2 changed, 1 new: declined then shared again clears), `live-missing-context.test.tsx` (1 changed). E2E `sources-browser.spec.ts` (lost + refused specs now assert the banner reason/title/fix; "next try works" asserts no banner).
- Claims (`claims.ts`, shared file, targeted edits): 196/225 covered at the start of my run (28 web pending) -> 219/225 covered, pending web 5, native 1 (native.start.agree, not mine). New specs, all passing in Chromium:
  - `web-shell.spec.ts` (6): view buttons (6 view rows + Home), Live dot against the DB, search palette, theme, Assistant, Presentations = 11 rows.
  - `web-code-canvas.spec.ts`: tabs Solution/Usage/Tests, Wrap, editing + Copy all (clipboard), Results, Output, Open in Workspace = 9 rows; plus the Run spec (below).
  - `web-ended-drafts.spec.ts` (2): Copy Answer draft (clipboard) and Open Workspace draft (URL) = 2 rows.
  - `web-band.spec.ts` + 1: Manual creates no task over more than one Auto interval, Auto then does = web.hf.manual.
- STILL PENDING (reason in `claims.ts` beside each row):
  - web.capture-problem.open-settings: only a native shell can raise it (native row covers the control).
  - web.signin.google / web.signin.linkedin: need real OAuth provider config; sign-in is the WEB package's.
  - web.auto.no-question-hold: Chromium's fake screen cannot be changed on cue, so a web spec cannot tell the hold from an unchanged screen (native proves it via the host shim).
  - web.code.run: see finding A.

## FINDING A (for the lead / SEC): Run on the web Code view is refused 401
`POST /api/v1/run-all` from the signed-in web page returns 401 "A valid API token or signed-in session is required" with the tenant header set, while `GET /api/interview/documents/context` with the same header returns 200 (verified in the e2e stack, built from the current checkout). Cause is in the in-flight HO-SEC-02 gate (`backend/api.ts` `authenticate` -> `verifySession` in `interview-backend.ts`), not in my files. User-visible: the Code view's Run button shows "Couldn't run" for every signed-in user until fixed. I captured it as `web code canvas Run` with `test.fail(true, ...)` (it passes now as an expected failure; remove the mark when the gate accepts the page, then mark `web.code.run` covered). Syntax-check and other `/api/v1` browser calls are probably affected the same way (UNVERIFIED).

## 4. Item 11d / L-1: DONE
- Rule: `AVAILABILITY_WORDING` in `backend/live-session/claims.ts`. Reproduced in `technical-figures.test.ts` with a scheduling-themed coding draft ("... the moment each is available again ... 3 days plus a 2 day cooldown ... 5 days later", exercise supplied): withheld `draft:preference_only_topic`. (Seconds/minutes durations do not trip it; the rule's durations are days/weeks/months/quarters and month names.)
- Fix: `DraftCheck.coding` (technical scope AND an exercise carried); both uses of `AVAILABILITY_WORDING` skip on a coding task. Kept: logistics answers, concept answers with no exercise, and the topical notice/pay sentence rules (a coding draft saying "my notice period is 3 months" is still withheld; both asserted). 3 new tests in `technical-figures.test.ts`.
- Not changed: the `ungrounded_figure` withhold (T4 rev 2) in the same finding is unconfirmed and untouched.
- Run: `pnpm exec vitest run products/interview/src/backend` = 124 files / 1,488 tests pass (includes DB-backed and the replay sets and hardening tests).

## 5. ADR-0007 repair (assistant-model.ts): DONE
- The attribute exists: `AiTargetSummary.family` ("direct-model" | "agent-runtime"). The documents context route only forwarded `{id, label}`, so I forwarded `family` too (one-line pass-through in `backend/documents/api.ts` `/context`, plus the type in `documents-client.ts`); no new server concept.
- `documentTarget` now prefers the first `family === "agent-runtime"` target; the `agent/claude-code` id check is gone. Behaviour note: with both agents listed, the first is preferred (the platform lists Claude Code first); a different listing order would change the default.
- Tests: `assistant-model.test.ts` (ids deliberately provider-free; failed first, 3 tests), `documents-view.test.tsx` fixtures carry `family`, `api.test.ts` asserts `family` on the target. Documents frontend 56 + backend documents pass.
- INV-0006 check (`git grep -n -i -E "openai|anthropic|lm[-_ ]?studio|gpt-|claude-" -- 'products/*/src/**' ':!*.test.ts' ':!*.test.tsx'`): `assistant-model.ts` no longer matches. Remaining matches, all in `live/shared/task-card-model.ts:298,305,431`: a display label map for runtime ids `claude-code` -> "Claude" and two comments quoting a model id. Display only, not a branch; per the check text the owner must judge it, so I did NOT mark the invariant pass and did not edit `reconciliation.yml`/the ledger (GOV's). The check as written still prints those three lines (exit 0 = matches).

## Test runs
- `pnpm exec vitest run products/interview scripts`: 307 files / 3,776 tests pass. `products/interview` typecheck (`tsc -p tsconfig.typecheck.json`) clean; `e2e/live-session` `tsc --noEmit` clean; biome clean on touched paths.
- Product dist rebuilt with `tsc -b` in `products/interview` (needed: the e2e web build consumes `dist`), then `E2E_REBUILD=1 E2E_DIST_DIR=.next-e2e-product`.
- Chromium: sources-browser + web-band + claims-coverage 19 pass; capture-tasks-web, missing-context, no-question, screenshots-tray, session-banners, smoke-web-capture, web-shell, web-ended-drafts 75 pass; web-code-canvas 2 pass + 1 expected failure (Run).
- WebKit @native: cross-surface-sync + capture-problem + native-details 15 pass (the F-OWNER spec is a normal pass); native-host, shortcuts, companion-capture, no-question, screen-picker-native, window-modes-native 30 pass. Live panel unchanged.

## UNVERIFIED / for wave 2
- Whole-suite e2e not run (lead). The 1.5% stale-marker flake is not shown fixed (item 2).
- Finding A needs SEC/WEB. No ADR text needed. `bionic/` docs were not touched.
