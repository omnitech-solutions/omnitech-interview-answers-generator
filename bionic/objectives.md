---
type: objectives
format_version: "1"
maturity: exploring
owner: "desoleary"
reviewed_at: 2026-10-07
review_every_days: 90
---

# Objectives for omnitech-interview-answers-generator

## Mission

Help a software engineer prepare for and perform in technical interviews: work questions into explainable, runnable answers, rehearse under realistic conditions, get hands-free help in the live interview itself, and keep what each interview teaches reusable. Done well, the candidate walks into every stage with answers they can run, defend, and say aloud, stays in control of what leaves their device while a live session runs, and their coding agents can drive the studio for them, all inside a tenant-aware platform that can host further products.

## Goals

### OBJ-1 — Answers that run and explain themselves

- **kind:** utility
- **statement:** A candidate can take any PHP, React, TypeScript, or Ruby question from understanding to a structured guide whose solution, usage, and tests run green in an isolated container.
- **measure:** For each supported language, a representative question completes Understand → Plan → Code → Test → Explain in Workspace, its usage runs, and its tests pass in the matching Docker runner.
- **status:** active

### OBJ-2 — Briefings deliverable aloud

- **kind:** utility
- **statement:** A candidate can open a concept or behavioural briefing and deliver it aloud within 30–90 seconds, using three practical talking points backed by real experience evidence.
- **measure:** unmeasured
- **status:** active

### OBJ-3 — Rehearsal under interview conditions

- **kind:** ux
- **statement:** A candidate can run a timed mock interview in which hints cost points and the outcome is kept as a scorecard to review afterwards.
- **measure:** A Rehearsal session starts, records each hint reveal against the score, and saves a scorecard that reopens with the same results.
- **status:** active

### OBJ-4 — Coding agents drive the studio

- **kind:** ease-of-use
- **statement:** A candidate can ask Claude Code, Codex, or OpenCode to answer, explain, or rehearse, and the result appears in the open studio without the agent knowing HTTP routes or credentials.
- **measure:** `/answer`, `/explain`, and `/mock-interview` each complete against a running studio through the `interview-answers` CLI, and the result is visible in Workspace, Briefings, or Rehearsal.
- **status:** active

### OBJ-5 — Private, tenant-isolated preparation

- **kind:** utility
- **statement:** A candidate's questions, answers, notes, and model output are visible only inside their own tenant and are never written to logs by default.
- **measure:** The database security suite proves cross-tenant reads and writes are refused under forced row-level security, and a product route without tenant membership returns 404.
- **status:** active

### OBJ-6 — Room for more products

- **kind:** delivery
- **statement:** A new product can join the studio through build-time registration and its own vertical without changes to the shell beyond registration.
- **measure:** A second product (Presentation) is served at `/t/<tenant>/p/<product>` through registration alone, and the steps in the adding-a-product reference are enough to add another.
- **status:** active

### OBJ-7 — Live help in the moment

- **kind:** ux
- **statement:** During a live interview a candidate can start a hands-free session on their own machine that notices the question on screen or in speech and shows a short, grounded answer they can say aloud, with generated tests run for a coding question, without touching the keyboard; and a coach that listens to the whole conversation puts a short, grounded note in front of them when one would help, and stays silent when none would.
- **measure:** A live session goes from capture or speech to task to answer in the native panel against a scripted model; the median question-to-draft time in the hardening latency test stays under 4 seconds; a spoken question is recognised wherever the ask falls in an unpunctuated transcript (policy tests on real calls); grounding is enforced by subtraction and never withholds an answer: a rejected claim or sentence is dropped, no part of an answer is ever a placeholder, and a STAR question always tells the closest approved story (assist-stage tests); the live coach posts its first line within about 10 seconds of a question on Claude Code or Codex, says nothing to a greeting, and marks a claim verified only when a code check finds it in the approved record (coach tests; ADR-0039). The coach will draw its facts from the context pack (ADR-0038) once that lands, which is the next step it depends on.
- **status:** active

### OBJ-8 — The candidate controls what leaves the device

- **kind:** utility
- **statement:** A candidate can see and choose what a live session sends off their device, including which display is watched and whether a screenshot reaches the model as an image, as text only, or not at all, and is told what was sent for each capture.
- **measure:** A device-only session refuses images on the server; a pinned display is the one captured; each screenshot shows whether its image or only its text was sent (Playwright claims for the policy, picker and label controls, covered in the browser suite).
- **status:** active

### OBJ-9 — Honest and visible assistance

- **kind:** ux
- **statement:** A candidate always sees the assistant's state and what each answer rests on: it never hides itself while capturing or listening, says whether code is only generated-tested or fully verified, keeps earlier revisions visible and marked outdated, and turns a capture with no question into a note instead of an answer.
- **measure:** Hiding the window pauses capture first; the verification badge mirrors the server's `fullyVerified`; a task shows its revision list with the current one marked and the Code panel follows the revision on show; a no-question capture or spoken turn creates no task and no failure; the Studio answer sits in the transcript with the question that opened it; the footer shows a sound wave while the microphone hears something (native and card tests, and the Playwright claims for them).
- **status:** active

### OBJ-10 — Every interaction proven

- **kind:** delivery
- **statement:** Each visible control and each claim the live session makes (a label, tooltip, toast or status line) is verified by its real effect in a real browser, so the screen cannot say something the product does not do.
- **measure:** The claims inventory in the browser suite lists every control, the coverage test fails on any control not in it, and strict mode (`E2E_STRICT=1`) passes with no claim left pending; what a browser cannot prove is listed for manual testing.
- **status:** active

### OBJ-11 — The native shell is the live surface

- **kind:** ux
- **statement:** The live session lives in the native shell's panels, built only from the shared component library: a task bar with Capture new problem, the Problem menu and revisions; a new problem comes only from a capture, every other input revises the task on show; the code language is chosen per problem and a Regenerate honours it; a session never expires on its own; Try again tells the truth about a gone session.
- **measure:** The web page no longer captures and Picture-in-Picture is gone (ADR-0033); every panel control is a library component (migration audit); Regenerate in PHP yields PHP code with its tests run (client and coding-stage tests); the session cap is the ten-year default; the native QA log's blocking issues are closed.
- **status:** active

### OBJ-12 — Fast, cancellable, streamed answers

- **kind:** ux
- **statement:** The candidate reads the answer as it is written and can stop it at any moment: the draft streams into the panel, is published within seconds of the model's last word, and the Claude agent runner is the one executor (no provider switching).
- **measure:** The worker records the draft so far on the action as it streams and the panel shows it within its one-second poll; a structured run completes at the model's structured-output call (one model iteration, measured 16–20 s per draft on a healthy API); Stop settles an in-flight draft as `owner_stopped` and no late write lands; `ai.execute` logs turns and API time so a slow run is attributable.
- **status:** active

### OBJ-13 — Nothing goes dark silently

- **kind:** delivery
- **statement:** Every step from microphone to published answer leaves a redacted, code-only trace that says where a question was lost: the shell and companion's one event log (user, page, heartbeat, server, system), the companion's speech and transcript events with sizes, the worker's gateway lines, and the database as the record of truth.
- **measure:** A stalled transcription is diagnosable from `events.jsonl` alone (audio fed per source, requests opened and ended, segments produced and queued); the event log never carries text, prompts or credentials (redaction tests); an answer that was not shown has a reason in the action row.
- **status:** active

## Shifts

_Newest first. Append a row whenever the mission or a goal changes; never rewrite history above._

| date | shifted | from | to | why |
|------|---------|------|----|-----|
| 2026-10-08 | OBJ-7 | Live help answers a question | Adds the live coach: it reads the conversation and writes short grounded notes as it happens, without overloading the person; depends on the context pack as its next step | Owner's direction: "transcript is the input to AI", start Claude and Codex coaching, streamed and proactive without overloading the user (owner decision; ADR-0039). |
| 2026-10-07 | OBJ-13 | Unspecified | Nothing goes dark silently | Owner's rule after a day of silent stalls: one redacting event log for app, companion and server (ADR-0034), speech and transcript events, gateway timings; the database is checked before any claim (owner decision). |
| 2026-10-07 | OBJ-12 | Unspecified | Fast, cancellable, streamed answers | Owner's decisions: streaming is required, a draft must be cancellable at any time, the Claude agent runner stays the executor, a minute-long draft is unacceptable (owner decision). |
| 2026-10-07 | OBJ-9 | Revisions visible; no-question captures are notes | Adds: answer sits with its question, Code panel follows the revision, no-question speech is never a failure, sound-wave recording indicator | Owner's directions during live QA (owner decision). |
| 2026-10-07 | OBJ-7 | Drafts with an ungrounded figure or preference-only claim are withheld | Grounding never withholds: subtraction only, no placeholders, a STAR question always tells the closest story, asks recognised mid-utterance | Owner's rule: "the experience matrix should not ever block an answer EVER"; "I NEVER want to see 'Not in your approved experience'"; a real call's "tell me about a project" was ignored (owner decision). |
| 2026-10-06 | OBJ-11 | Unspecified | The native shell is the live surface | Owner's decisions over the native rework: Picture-in-Picture and the in-tab card deleted (ADR-0033), library components only, task bar with Problem and revisions menus, new problem only from a capture, language per problem, sessions never expire (owner decision). |
| 2026-10-05 | OBJ-10 | Unspecified | Every interaction proven | Owner asked for Playwright coverage so each interaction does what the screen says (proposed by Claude on the owner's instruction; pending owner review). |
| 2026-10-05 | OBJ-9 | Unspecified | Honest and visible assistance | Owner's directions: window modes that pause capture before hiding, revisions list, no-question captures are notes, verified-vs-generated labels (proposed on instruction; pending owner review). |
| 2026-10-05 | OBJ-8 | Unspecified | The candidate controls what leaves the device | Owner's concern about screenshots going to the model by default; accepted setting (always / text only when the screen is just text / never), display picker and sent-as labels (proposed on instruction; pending owner review). |
| 2026-10-05 | OBJ-7 | Unspecified | Live help in the moment | The Active Session work (hands-free capture, speech, grounded drafts) is most of the recent product direction and was missing from the goals (proposed on instruction; pending owner review). |
| 2026-10-05 | mission | Prepare for and perform; answers, rehearsal, reuse | Adds hands-free help in the live interview and control over what leaves the device | Owner asked for the objectives to be refined from the direction the project has taken; the first sentence's "perform" was unserved by any goal (proposed on instruction; pending owner review). |
| 2026-10-02 | mission | Placeholder | Interview preparation and performance, agent-drivable, on a tenant-aware platform | Owner asked for objectives drafted from the current product; goals are hypotheses until the owner reviews them. |
| 2026-10-02 | OBJ-1 | Unspecified | Answers that run and explain themselves | Workspace guides and isolated runners are the core of the product. |
| 2026-10-02 | OBJ-2 | Unspecified | Briefings deliverable aloud | Briefings exist to be spoken in an interview. |
| 2026-10-02 | OBJ-3 | Unspecified | Rehearsal under interview conditions | Rehearsal simulates the real interview's pressure. |
| 2026-10-02 | OBJ-4 | Unspecified | Coding agents drive the studio | The CLI and project skills let agents push work into the studio. |
| 2026-10-02 | OBJ-5 | Unspecified | Private, tenant-isolated preparation | Tenancy and no-logging rules protect the candidate's material. |
| 2026-10-02 | OBJ-6 | Unspecified | Room for more products | The platform shell is built to host further products. |
