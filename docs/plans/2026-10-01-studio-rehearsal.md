# Interview Studio Rehearsal (redesign sub-project 6 of 6)

Status: implemented 2026-10-01 on `master`, under the operator's authorisation to implement the redesign end to end. Earlier steps: [shell](2026-10-01-studio-shell.md), [workspace](2026-10-01-studio-workspace.md), [home](2026-10-01-studio-home.md), [briefings](2026-10-01-studio-briefings.md) and [knowledge](2026-10-01-studio-knowledge.md).

## Outcome

Rehearsal (`/t/local/p/interview/rehearsal`) is the design's timed mock interview, built on the person's own material.

- **Setup:**
  - three format cards, each with its concept/coding split bar:
    - **Full loop · 60 min:** 15 concept + 45 coding
    - **Coding · 45 min**
    - **Concept sprint · 15 min**
  - a **Questions** row with **Change**, which opens pickers
  - **Interviewer follow-ups** and **Strict mode** switches
  - **Start {format}**
- **Live:**
  - **Header:** phase name, progress bars, phase clock and session clock, then **Start coding**, **Pause** (not in strict mode) and **End session**.
  - **Banners:** a five-minute warning, a last-minute warning and a "Paused" banner.
  - **Left column:** the concept question with a "Points I missed…" box, or the coding statement with its first example, a solution box and a **Complexity** input. Interviewer follow-ups are asked one at a time.
  - **Right column:** **Hints** (−3 each) during coding, and the **Did you…** checklist.
- **Score:**
  - a score ring, coloured green at 75+, amber at 50+ and red below 50
  - a headline: Strong session, Solid with gaps, or Worth another run
  - the breakdown: checklist points minus the hint cost
  - Checklist / Hints opened / Time used
  - **Practise next:** the first two missed checklist items open the coding question, and the concept opens its brief
  - **Rehearse again** and **Back to prep plan**
- **Focus mode:**
  - While a session is live, the sidebar steps aside and the open assistant closes once.
  - **Strict mode** also hides the Assistant toggle and keeps the assistant closed, including ⌘J.

## Data, not mock content

- **Concept questions:** the person's concept and system-design briefs, followed by three built-in prompts (`FALLBACK_CONCEPTS`). A brief's `followUps` become the interviewer's follow-ups.
- **Coding questions:** the person's Workspace drafts.
- **Hints:** taken from the answer guide:

  | Hint | Source |
  |---|---|
  | clarify | `understand.clarify` |
  | hint | first `plan.steps` |
  | pattern | first `explain` heading |
  | approach | numbered `plan.steps` |
  | edge cases | `edgeCases` |
  | solution / tests | `answer.code` / `testCode` |

  A hint the answer cannot supply is not offered. The solution and tests unlock only once a complexity has been stated.
- **Config:** formats, checklist, hints, fallback prompts, warning thresholds and headlines are all in `studio/rehearsal/config.ts`.

## Storage and API

- **Contracts.** `@omnitech/interview-contracts` adds `rehearsal.ts`:
  - format and reveal enums
  - the session input (strict)
  - the session and list schemas
  - `rehearsalScore`: 10 per checklist item, −3 per hint, clamped to 0–100
- **Migration.** `0010_rehearsal_sessions.sql` adds `interview.rehearsal_sessions` with private-scope row-level security.
- **Router.** `createRehearsalApi` at `/api/interview/rehearsals`:
  - `GET` lists the latest 20.
  - `POST` saves a finished session. **The server computes the score** and removes duplicate checks and hints first.
  - Writes from other sites get 403.
- **Plan status.** `rehearsalStatus(database)` feeds `createPlanApi`'s rehearsal items, so Home's plan shows "Last score N" (good at 75+), or "Not rehearsed yet".
- **Client.** `createRehearsalClient` in `@omnitech/interview-api-client`.

## Shell change

`StudioContext.setFocus("live" | "strict" | null)`. The view sets focus only while its session is live and clears it on unmount.

## Verification

- **Tests:**
  - API (Postgres): scoring, de-duplication, newest-first order, plan status, validation, privacy, cross-site refusal
  - client
  - view:
    - setup and pickers
    - a full loop with follow-ups, checks, locked and opened hints, the saved payload and Practise next
    - strict coding with the 5 and 1 minute warnings and automatic end
    - pause and the clock, and a save failure
  - material and config helpers
  - shell focus mode
- **Browser:**
  - a full loop on a real draft: hints from its guide, the solution unlocking after the complexity, a score of 17 saved, and Home's plan showing "Last score 17"
  - a strict concept sprint: the open assistant closed, the toggle hidden, no Pause

## Not done

- **Saving the rehearsal's code and notes.** Neither is stored or run; the scorecard is self-assessed, as in the design.
- **Assistant follow-ups.** The assistant host has no `send`, so follow-ups are scripted (from the brief, or generic for coding) rather than asked by the assistant.
- **Legacy `MockInterview`.** It is still used by the local-mode `workspace.tsx`.
