# UI audit and quality pass (2026-10-06)

Owner brief: make the app as solid as reasonable; verify against the designs; swapping
models works; audit every web page from the UI; AI generation (resume, per-field regen,
coding) is excellent; the native coding panel matches the main answers page; the native
app shows as "Interview Studio" in the menu bar when clicked; a live session started in
the web is picked up by the native app; listening to an interview works on real questions
only and answers appear as talking points. Do the work, verify each step, record evidence.
The owner is tired and trusts the lead: decide, verify, do not stop to ask.

Status: TODO | DOING | DONE (evidence) | DEFERRED (reason)

## Harness (how things are tested)
- `e2e/live-session/.audit/crawl.mts`: signs in as the local user against the Docker stack
  on :3000 and visits pages: screenshot, console errors, failed requests, an inventory of
  every button, link and input (and how many have no accessible name).
- `e2e/live-session/.audit/probe.mts`: calls an API from the signed-in page, prints status and body.
- Scratch only (gitignored `.audit/`). Real model calls go through the Claude Code agent runner
  on the host worker; LM Studio is never used or loaded.

## A. Native app
| # | Item | Status |
| --- | --- | --- |
| A1 | A press on the panel makes "Interview Studio" the active app (menu bar, Cmd-Tab); capture focus is unaffected | DONE in code (`PanelActivation`, test); verify on the real app |
| A2 | A live session started in the web is picked up by the native app | DONE in the store (discovery every 5 s while none is open; 3 tests); verify against the open "Rehearsal" session in the real app |
| A3 | Native panel matches `Native Panel.html` / `Native Sign-in.html` | TODO (sign-in verified; compare live, idle, ended screens) |
| A4 | A way to drive and check the native panel without clicking (accessibility labels, state in the page) | TODO |

## B. Coding exercise quality (live session vs main answers)
Finding: the live coding stage (`live-session/coding-stage.ts`) has a bare policy and none of the
main app's contract (`interview-contracts/src/workflows.ts`: header, labelled comments, entry point first,
usage cases, per-language rules). Its output has no guide.
| # | Item | Status |
| --- | --- | --- |
| B1 | Live coding stage uses the main app's code contract | DONE (shared `codeQualityRules`; 565 tests) |
| B2 | Code card tabs: Solution / Usage / Tests (like the main page) | DONE (unit tests; verify in the real card) |
| B3 | A failed test takes you to the failing test (tests tab, line) | DONE (unit tests) |
| B4 | Tests are always generated and run | DONE for the eval; the host worker runs them in Docker (verify in the stack) |
| B5 | 15 different questions through the real model, output reviewed | DONE: 15/15 rubric, all tests green; lead reviewed the linked-list output (header, labelled reasons, usage, 6 tests) |

## C. AI generation
| # | Item | Status |
| --- | --- | --- |
| C1 | Resume generation: excellent, grounded in the experience matrix, no padding | TODO |
| C2 | Per-field regeneration stays within the field's length and tone | TODO |
| C3 | Swapping assistant models works (Claude Code models; never load LM Studio) | TODO |

## D. Web app, page by page (Docker stack, :3000)
Crawl 1 (7 pages): problems found and their state.
| # | Finding | Status |
| --- | --- | --- |
| D-1 | Documents: "could not load" (400 on templates). Cause: Turbopack collapses `new URL(`./assets/${name}`)` to one file, so the markdown template read a docx. Fix: literal per-asset URLs (`built-in-assets.ts`) + the API now returns the fixed refusal reason | DONE (templates 200 in the stack; 75 tests) |
| D-2 | Work: Run tests / syntax check 503 in the Docker stack (no Docker in the container) | DONE: host code runner service + `RemoteCodeRunner` (6 + 3 tests); `run` prints 42 and syntax-check answers through the stack |
| D-3 | `node:22-alpine` image missing on the host | DONE (pulled) |
| D-4 | Home, Briefings, Live session render correctly; Knowledge, Rehearsal not yet reviewed | TODO |

| # | Page | Interactions to exercise | Status |
| --- | --- | --- | --- |
| D1 | Home | New question, Start a rehearsal, prep plan add/open/check, Edit interview, Continue rows, recent questions, search palette (Cmd-K), assistant | TODO |
| D2 | Workspace / answer page (`/work`) | steps Understand..Test, tabs, Run tests, versions, regenerate, copy, new question, assistant | TODO |
| D3 | Briefings | Concept / System design / Behavioural build, list, open | TODO |
| D4 | Documents | templates list, generate resume, per-field regenerate, preview, download, history | TODO |
| D5 | Knowledge | articles, search | TODO |
| D6 | Rehearsal | start, timer, answer, score | TODO |
| D7 | Live session (web) | setup, start, Auto/Manual, capture, transcript, pause, end, ended summary | TODO |
| D8 | Settings / integrations | connect, disconnect | TODO |
| D9 | Sign-in, signed-out, share pages | | partly DONE |

## E. Listening to interviews (transcripts)
Brief: when the app listens (computer mic and the other side), it must work only on real
questions; answers appear as talking points like solutions do (point form, bold key terms), accurate
to the experience matrix. Manual mode: captured text collects in the prompt box; Enter drafts the
answer; the next captured speech starts filling the box again.
Fixture: `~/Desktop/Zensurance Pre-Screen 2026-10-02 11:45(GMT-6:00).txt`.
| # | Item | Status |
| --- | --- | --- |
| E1 | Read how listening works today | DONE: engine posts `transcript.final` to /ingest (mic = candidate, app audio = interviewer); server gate (`interview-policy`) opens tasks; assist stage classifies + drafts. Manual dictation fills the message box; the native engine runs only in Auto and its bridge is content-free |
| E2 | A replay harness through the real ingest path | DONE: `.audit/replay.mts` (real envelope, credential, pacing; limit 120/min), eval stack on :3010 (cloned DB, own worker) |
| E3 | Speech loopback test with macOS `say` through the speakers into the real mic (end to end on the Mac app) | TODO (optional, needs the user's room) |
| E4 | Only real questions get answers; talking points with bold key terms; grounded; no invented claims | PARTLY: gate recall 13/13 on the real transcript, greetings/audio checks shut (table test); drafts now valid and point-form (12/12 + 6/6 in eval). TODO: one question split across fragments opens several tasks (058/061/065/067); verify in the pipeline |
| E5 | Manual mode behaviour as described above | TODO |
| E6 | Research on Cluely and similar apps | DONE (report: little is public; clones use dual-source audio, LLM judges the question over a window, manual = hotkey/Ask button + text box; test with transcript replay, `say` + loopback) |

## F. Infrastructure for the above
| # | Item | Status |
| --- | --- | --- |
| F1 | Host services script (`docker-host-services.sh`): worker + code runner, `pnpm app:up` | DONE |
| F2 | Commit and push in small commits; full `pnpm verify` before each push | ongoing |

## Log
- 2026-10-06 (later): coding worker (15/15) and assist worker (12/12, 6/6) reviewed and committed; question gate fixed (greetings no longer open tasks, 'I'd love to hear' does); 3 commits. Orphaned worker bug found and fixed (kill the process tree).
- 2026-10-06: crawl 1; D-1, D-2, D-3 fixed; A1, A2 built.
