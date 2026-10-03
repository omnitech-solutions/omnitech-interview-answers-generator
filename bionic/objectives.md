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

Help a software engineer prepare for and perform in technical interviews: work questions into explainable, runnable answers, rehearse under realistic conditions, and keep what each interview teaches reusable. Done well, the candidate walks into every stage with answers they can run, defend, and say aloud, and their coding agents can drive the studio for them, all inside a tenant-aware platform that can host further products.

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

## Shifts

_Newest first. Append a row whenever the mission or a goal changes; never rewrite history above._

| date | shifted | from | to | why |
|------|---------|------|----|-----|
| 2026-10-02 | mission | Placeholder | Interview preparation and performance, agent-drivable, on a tenant-aware platform | Owner asked for objectives drafted from the current product; goals are hypotheses until the owner reviews them. |
| 2026-10-02 | OBJ-1 | Unspecified | Answers that run and explain themselves | Workspace guides and isolated runners are the core of the product. |
| 2026-10-02 | OBJ-2 | Unspecified | Briefings deliverable aloud | Briefings exist to be spoken in an interview. |
| 2026-10-02 | OBJ-3 | Unspecified | Rehearsal under interview conditions | Rehearsal simulates the real interview's pressure. |
| 2026-10-02 | OBJ-4 | Unspecified | Coding agents drive the studio | The CLI and project skills let agents push work into the studio. |
| 2026-10-02 | OBJ-5 | Unspecified | Private, tenant-isolated preparation | Tenancy and no-logging rules protect the candidate's material. |
| 2026-10-02 | OBJ-6 | Unspecified | Room for more products | The platform shell is built to host further products. |
