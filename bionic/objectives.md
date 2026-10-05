---
type: objectives
format_version: "1"
maturity: exploring
owner: "desoleary"
reviewed_at: 2026-10-02
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
- **statement:** During a live interview a candidate can start a hands-free session on their own machine that notices the question on screen or in speech and shows a short, grounded answer they can say aloud, with generated tests run for a coding question, without touching the keyboard.
- **measure:** A live session goes from capture to task to answer in the native panel and in the web page against a scripted model; the median question-to-draft time in the hardening latency test stays under 4 seconds; drafts with an ungrounded figure or a preference-only claim are withheld, not shown (grounding guard tests).
- **status:** active

### OBJ-8 — The candidate controls what leaves the device

- **kind:** utility
- **statement:** A candidate can see and choose what a live session sends off their device, including which display is watched and whether a screenshot reaches the model as an image, as text only, or not at all, and is told what was sent for each capture.
- **measure:** A device-only session refuses images on the server; a pinned display is the one captured; each screenshot shows whether its image or only its text was sent (Playwright claims for the policy, picker and label controls, covered in the browser suite).
- **status:** active

### OBJ-9 — Honest and visible assistance

- **kind:** ux
- **statement:** A candidate always sees the assistant's state and what each answer rests on: it never hides itself while capturing or listening, says whether code is only generated-tested or fully verified, keeps earlier revisions visible and marked outdated, and turns a capture with no question into a note instead of an answer.
- **measure:** Hiding the window pauses capture first; the verification badge mirrors the server's `fullyVerified`; a task shows its revision list with the current one marked; a no-question capture creates no task (native, web and card tests, and the Playwright claims for them).
- **status:** active

### OBJ-10 — Every interaction proven

- **kind:** delivery
- **statement:** Each visible control and each claim the live session makes (a label, tooltip, toast or status line) is verified by its real effect in a real browser, so the screen cannot say something the product does not do.
- **measure:** The claims inventory in the browser suite lists every control, the coverage test fails on any control not in it, and strict mode (`E2E_STRICT=1`) passes with no claim left pending; what a browser cannot prove is listed for manual testing.
- **status:** active

## Shifts

_Newest first. Append a row whenever the mission or a goal changes; never rewrite history above._

| date | shifted | from | to | why |
|------|---------|------|----|-----|
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
