# Final report: Live session redesign and everything built on top of it

Written 2026-10-05 (afternoon). Commit `5d416bd` on `feat/active-session` (758 files, not pushed).
Read the "What is NOT verified" section before trusting any green number.

## 1. Status in one paragraph

Everything the plan listed is built and committed. `pnpm verify` passed on a quiet machine
(exit 0). Five independent read-only reviews found blockers; all were fixed by separate workers
and are in the commit. A whole-suite Playwright run on the final code was started after the
commit (result in section 3). What has NOT been seen is any of it running in the real native
app: every native/Swift behaviour is proven by unit tests, the host shim, and WebKit, not by a
real window over a real desktop. Section 8 is the matrix of what you need to try.

## 2. What shipped (by area)

| Area | What you get |
|---|---|
| Screenshots on the answer page | Screenshots button with count; Auto: minimised scrolling strip; Manual: staging tray (open by default): capture stages on the device, crop, reorder, remove, viewer (zoom, pan, Fit, 100%), Apply = ONE request (new problem, or one new revision of the selected task), Discard. Per-image on-device OCR. Display name and "n of m" kept per screenshot. |
| Revisions | A task's revisions are a list; one transcript row per task; selecting a revision swaps answer, code and chat text; follow-ups always go to the current revision; regenerate and Apply add a revision to the same task. |
| No-question captures | A capture that shows no interview question is a note, not a task (no T-number, never newest). A real task whose later revision finds no question stays and is labelled "No question found". Auto backs off. |
| Screenshots to the model (OBJ-8) | Setting: Always (default) / Text only when the screen is just text / Never, on web setup, web Sources tab, native Settings, card popover. Enforced on the server; per-screenshot "Image sent / Sent as text only / Not sent" labels. |
| Capture reliability | Explicit captures target the last-focused browser even if another app is in front; display/region captures render browser windows only; every failure shows a banner with a closed reason and a fix (e.g. an exact Screen Recording settings link). |
| Toolbar | ONE See-through control (clear glass plus region-based pass-through: only transparent areas pass clicks to what is underneath); ONE split capture control (click captures; chevron / right-click / Down opens the screen menu with live previews and pin). Window dots: yellow hides (pausing first), green full screen / menu, red quit confirm. Mini player and full screen. |
| Microphone | Native engine owns the mic in Auto; the page never asks for the microphone itself (the "Allow 127.0.0.1" prompt cause); mic button label and action share one predicate. |
| Docs/tooling | arch data model for Drizzle through Crux's `arch_extractors` seam (`pnpm docs:arch`), `arch.require` gate, `bionic-regeneration` and `technology-references` skills, six pinned Drizzle research sources, objectives OBJ-7..OBJ-10 (pending your review), Crux feature requests drafted in `bionic/inbox/`. |
| Playwright suite (OBJ-10) | `e2e/live-session`: about 364 tests on chromium and webkit with a claims inventory (170 of 198 covered), real Postgres, built Next app, real worker with a scripted model, native host shim. |

## 3. Evidence (what I ran and saw myself, versus what workers reported)

Lead-verified (commands run by me, output read):
- `pnpm verify` exit 0: lint, format, typecheck, 432 test files / 5,001 tests passed (2 skipped), build 29/29 tasks, `studio-shell-tests` 141 passed 0 failed, `capture-core-tests` 63 passed 0 failed, `verify-native: ok`. (First attempt failed on Biome linting the generated OCR assets: fixed in `biome.json`; second attempt failed on a pinned migration list: fixed in `migrate.test.ts`; third passed.)
- `pnpm docs:arch:check` exit 0 and `extract-code-docs --dry-run` exit 0 on the committed state (OCR assets removed first); all seven ADR/index gates `--dry-run` exit 0; `pnpm exec vitest run scripts` 19 files / 90 tests.
- Whole-suite Playwright on the committed code (`E2E_REBUILD=1`, chromium + webkit, no retries, headless): 361 passed, 3 skipped (WebKit clipboard), exit 0, 19.1 min. The single reported failure is the intentional F-OWNER `test.fail` (counts as a pass). Claims 170/198 covered (28 web pending, 0 native pending).

Worker-reported only (not re-run by me): per-feature unit counts, E-B1..E-B4/E-C runs (three consecutive clean whole-suite runs of 361 passed / 0 failed / 3 skipped on the pre-review snapshot), the five review reports' file:line claims (each reviewer verified by reading, none ran tests).

## 4. Independent reviews (five, read-only) and their fixes

Verdict of all five: ship after fixes. Blockers found and fixed before the commit:
- R4 Swift: capture reached beyond browsers (whole-display capture with another app in front, or a display with no browser on it) -> browser-windows-only filters and refusal; pass-through updates re-rendered and stole focus -> surface-only commands.
- R1 backend: OCR text budget counted characters but the prompt cap counts bytes (CJK/Cyrillic screens refused permanently) -> byte budget with newest-first dropping.
- R3 frontend: a real task vanished when its newest revision was no-question; a session change during Apply stuck the tray and could send one session's screenshots to another -> fixed.
- R2 overlay: the mic button could do the opposite of its label (while paused or with the engine running without the mic) -> one predicate.
- R5 tooling: committed arch map indexed gitignored machine-local files; two claims recorded wrong evidence; a guard reason called a trigger-disabling write read-only -> fixed (Playwright output moved to dot-directories, claims evidence corrected and a disagreement check added, wording corrected).
Plus about 40 should-fix/nit items; the complete list with decisions is in `plan.md` section 7.0s and 7.0t.

## 5. Bugs found and fixed during the session (user-visible)

Capture silently idle when the Claude app was in front (no reason shown); click-through trapped the toolbar; three confusing screen icons; transparent mode not see-through (hard-coded 28 px blur); mic stop button did nothing in native Auto; mic button inert in Manual (regression, caught by E-B2); owner-microphone phrases missing from the Transcript tab; "Alt+Shift+A" printed but not bound; viewer Zoom in did nothing; an older revision's Code tab was empty; yellow hide did nothing in the expanded form and showing it switched to the wrong form; the "Allow 127.0.0.1 to use your microphone" prompt (page-level microphone requests in a native host); Auto sent images with no OCR text at all.

## 6. Open items and decisions for you

1. F-OWNER: with the native app owning hands-free, the web Live page says "running in another Studio window / No source shared" and still offers Capture & analyze. Misleading. Proposed fix: "The Interview Studio app owns capture" and disable/redirect the web button. A spec documents it as an expected failure. Is this what you noticed in screenshot 51?
2. Capture flows are split (screenshot 50): the toolbar capture analyses a new problem immediately, the answer pane's capture stages into the tray. You suggested the toolbar capture should use the same staging. Not acted on: your decision.
3. Rare intermittent (about 1.5 percent of isolated runs): native Manual no-question shows a stale "Drafting an answer" marker. Not reproduced by T38; candidates: a tie in `mergeActions` or a late backend flag. Needs the action rows from a failing run.
4. Web declined share shows a plain alert, not the capture banner (F8); 28 web claims still pending (shell nav, OAuth, code tabs/run, ended controls, no-question-hold, capture-problem web rows).
5. Known gap: the arch/code scanners ignore .gitignore, so with `apps/web/public/ocr` present `pnpm docs:arch:check` drifts (exit 1). Run `rm -rf apps/web/public/ocr` before deriving, then `node apps/web/scripts/copy-ocr-assets.mjs`. A second Crux request ("honour .gitignore") is drafted in `bionic/inbox/crux-feature-request-drizzle.md`.
6. ADRs owed (decisions D28 to D38 live in `plan.md`, not in ADRs): revision/regenerate model, OCR, screenshots-to-model privacy setting, no-question captures, region-based pass-through, the arch extractor override. Say which to write.
7. Your decision: exporting `CRUX_ARCH_ALLOW_OVERRIDES=1` session-wide is NOT recommended (it lets Crux run repo Python in every repo); the safe scoping is the pnpm scripts or a per-command prefix. `.env` default is set for this repo's scripts only.
8. Objectives OBJ-7..OBJ-10 and the mission extension were added on your instruction and are marked pending your review (`reviewed_at` not bumped).
9. Skills: `bionic-regeneration` (you questioned its scope: parked, unchanged except the known-gap updates) and `technology-references`. No `used`/`evaluated` forge-log entries yet (Crux requires a real use first).
10. Other-repo processes (agent-worker 64834, tsc watch 64795, pnpm 64790 of `omnitech-interview-answers-generator`) were never touched.
11. Anthropic model defaults lag claude-sonnet-5-5 / opus-5-5; ADR-0023 acceptance and AGENTS.md rule 5 wording (from the Drizzle audit); complexity field (G8); L-1 grounding guards withhold recovery drafts.
12. Native app: REINSTALLED from the committed code (build id `5d416bd+`) at `~/Applications/Interview Studio.app` after you quit it. The server it loads is my isolated stack on :3100: web = `next start` of the final build, worker restarted on the final backend code, isolated DB migrated (`screenshot_send`). The earlier `next dev` server on :3100 had died (killed by the build or by a finished worker); it was replaced. Your :3000 stack and the other repo's processes were not touched.
13. Boot-time pending-migration check added: `verifyMigrations` in `@omnitech/database` (next to `verifyDatabaseRole`), called strictly by the agent worker's boot (refuses to start, message names `pnpm db:migrate`) and tolerantly by `apps/web/instrumentation.ts` -> `instrumentation-node.ts` (Next's documented startup hook; unreachable database does not stop the server, a definite mismatch does; what Next does on a throwing `register` is unverified). Migrations are never run at start. Expected names are embedded in `packages/database/src/migration-names.ts` because bundled apps cannot read the drizzle folder; regenerate with `pnpm --filter @omnitech/database run db:names` (a guard test fails when stale). Details: plan.md 7.0x (T40).
14. WebKit e2e microphone guard: the WebKit project ran with a real microphone grant and raised macOS's 'Allow microphone' dialog (screenshots from the user, one at a time over the panel). Fixed by `e2e/live-session/src/fixtures/webkit-mic-guard.ts` (page-level replacement of `getUserMedia`/`enumerateDevices`/speech recognisers, enforced per test) and no grant for WebKit; `E2E_LIVE=1` adds a timestamped per-test live reporter. The triggering spec was not bisected; the 20 WebKit files pass with the guard. You watched the stubbed run and confirmed no dialog appeared. Details: plan.md 7.0y.

## 7. What is NOT verified (be sceptical here)

- Nothing has been seen in the real native app since the reinstall of the final build (your live results go in the matrix below).
- ScreenCaptureKit capture, the Carbon global hotkeys, real window geometry, always-on-top, real pass-through of mouse events to Chrome, the WindowServer shadow, the real Settings window, app audio via the companion, real Vision accuracy/latency, the real Tesseract worker in a browser, two-display behaviour, and a real microphone permission prompt.
- Live-model behaviour of the new prompt wording (no-question category, withheld-image wording, text-only gate) was only exercised against scripted models.
- The final Playwright whole-suite run result is in section 3; the reviewers' fixes were all made after the E-C green runs.

## 8. Manual test matrix (what only you can check)

Legend: PW = covered by a Playwright spec (proves the page/shim behaviour only); Live = needs the real app.

| # | Area | Interaction | Expected | How to test | PW | Live |
|---|---|---|---|---|---|---|
| M1 | Install | Open the reinstalled app | Panel opens, paired to your server; macOS may ask Screen Recording/Microphone once | Quit, reopen; grant | no | todo |
| M2 | Capture | Capture button / ⌘⇧S with Chrome in front | Manual: screenshot staged ("Not sent yet"); Auto: analysed | Press with leetcode open | shim | todo |
| M3 | Capture policy | Claude (or Slack) in front, Chrome last focused; press Capture | Chrome window captured; the other app is NOT in the image | Check the staged thumbnail and the viewer | unit | todo |
| M4 | Capture policy | Chrome hidden (⌘H) / minimised / other Space | Banner "No browser window" with the fix; nothing captured | Hide Chrome, press Capture | unit | todo |
| M5 | Privacy | Another app (1Password, Slack) in front of Chrome on the same display | Not visible in the image or the OCR text | Compare thumbnail with the screen | unit | todo |
| M6 | Permission | Revoke Screen Recording, press Capture | Banner with an "Open Screen Recording settings" button that opens the right pane | System Settings toggle | shim URL | todo |
| M7 | Auto | Auto on, browser in front | Re-analyses on change, at most every 8 s; shows the reason when it cannot | Switch apps; watch the strip | shim | todo |
| M8 | Screen picker | Chevron, right-click, Down arrow on the capture button | Menu with Follow my browser and each display with a live thumbnail; previews only while open | Open/close; watch CPU | shim | todo |
| M9 | Screen picker | Pin a display, restart the app | Pin persists; unplug the pinned display: one toast, back to following your browser | Two displays | shim | todo |
| M10 | Display label | Capture on display 2 | Thumbnail/viewer say "Display 2 of N" | Two displays | PW | todo |
| M11 | See-through | Turn on (⌘⇧I or the button) | Panes show the page through; empty glass passes clicks to Chrome (type, scroll, click a link under it); toolbar, panes, menus, footer stay clickable | Click through to Chrome; click the toolbar | regions only | todo |
| M12 | See-through safety | Kill/reload the panel page or hide with yellow | Window becomes interactive again within ~15 s; never stuck | Reload the page | unit | todo |
| M13 | See-through legibility | Menus and the status strip over busy text | Menus dense and readable; strip text readable | Open Manual/Auto menu over code | contrast | todo |
| M14 | Window shadow | See-through on | If a shadow shows through glass: recipe in plan.md 7.11 (`hasShadow`) | Look at the edges | no | todo |
| M15 | Window dots | Yellow hide then show (menu bar, ⌘⇧V, Dock) from Normal, Mini, Full screen | Same form comes back; capture was paused first | Try all three forms | shim/unit | todo |
| M16 | Window dots | Green click; hover 1 s | Click = full screen; hover = size menu (Normal, Mini, Full); Esc leaves full screen only, not while typing | Try on the 2nd display | shim | todo |
| M17 | Mini player | Stop analysis, Pause/Resume, Back to normal | Controls work; Esc does NOT leave it | Use it | PW | todo |
| M18 | Microphone | Auto on: watch for any "Allow 127.0.0.1" prompt for 2 minutes incl. an engine restart | No prompt; "Recording in Progress" row appears; mic button flips label only on the engine's report | Leave Auto on; press Alt+R | spy PW | todo |
| M19 | Microphone | Pause the session | Mic button disabled "Resume the session first"; Resume restores listening | Pause/resume | unit | todo |
| M20 | Microphone | Manual, Auto off, press the mic | Falls back to browser dictation (may prompt once) | Try it | PW | todo |
| M21 | OCR | Capture code, prose and a diagram | Text read well; time under about 4 s; text-only gate keeps the image for code/diagrams | Compare staged item states | stub | todo |
| M22 | Tray | Stage 3 images; crop one; reorder; remove; Apply to New problem and to Add to T{n}; Discard | One request; order kept; revision added to the same task | Use it | PW | todo |
| M23 | Viewer | Zoom, pan, Fit, 100%, Esc, crop | Image really enlarges and pans | Open a thumbnail | PW | todo |
| M24 | Strip | Many screenshots | Horizontal scroll with arrows | Capture 8+ | PW | todo |
| M25 | Setting | Change Always / Text only / Never in web setup, Sources, native Settings, card popover | One post per click; applies to the next model call; device-only locks it; labels show what was sent | Switch mid-session | PW | todo |
| M26 | Revisions | Pick an older revision | Answer, code and chat text swap; Outdated marks; follow-up says it goes to the current revision | Regenerate twice | PW | todo |
| M27 | No-question | Auto on a Studio-only screen | Notes ("no question found"), no new tasks, Auto holds | Leave Auto on | PW | todo |
| M28 | Tests drawer | |>| handle | Opens/closes; counts, per-test list, failure messages; works narrow | Coding answer | PW | todo |
| M29 | Code pane | Copy answer/code/tests | Clipboard has the text | Paste | PW chromium | todo |
| M30 | Settings window | Open ⌘, / menu | "Consent required" with no session; skill/language; keys popover lists ⌘⇧I See-through | Open it | PW | todo |
| M31 | Hotkeys | ⌘⇧S, ⌘⇧I, ⌘⇧V, ⌘⇧C | Each does what the keys popover says; any collision with Chrome | Press them | intent only | todo |
| M32 | Ended | End, Open summary, delete data | Summary opens in the browser; data deleted | End a session | PW | todo |
| M33 | Toasts | "Paused while hidden" | Shell-drawn toast visible | Hide while live | no | todo |
| M34 | Web page | Live page while the native app owns capture | F-OWNER: see section 6.1 | Open localhost live page | xfail | decide |
| M35 | Web page | Pop out (picture in picture), declined screen share | PiP opens; declined share message | Chrome | PW | todo |
| M36 | Device-only | Start a device-only session from the web setup page in real Chrome | Works (the headless crash is headless-only) | Try it | n/a | todo |
| M37 | App audio | Companion pairing, app audio | Audio flows | Pair | no | todo |
| M38 | Real model | Missing-context journey with the real model; guard-withheld recovery | Honest wording; recovery works (L-1 open) | A cut-off problem | scripted | todo |
| M39 | Performance | Menu open with thumbnails, Vision OCR, Auto | CPU and memory sane; no focus stealing while typing in Chrome | Activity Monitor | no | todo |

## 9. Commands

- Full gate: `pnpm verify`. Docs: `pnpm docs:arch`, `pnpm docs:arch:check` (delete `apps/web/public/ocr` first, restore with `node apps/web/scripts/copy-ocr-assets.mjs`).
- Browser suite: `cd e2e/live-session && E2E_REBUILD=1 pnpm test:browser` (needs Docker, `pnpm test:browser:install`).
- Native: `cd apps/studio-shell && swift build -c release && sh scripts/bundle-app.sh` then copy `.build/InterviewStudioShell.app` to `~/Applications/Interview Studio.app`.
- After a Drizzle migration: `pnpm docs:arch`.
