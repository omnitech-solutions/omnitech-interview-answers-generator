# Interview Studio Briefings (redesign sub-project 4 of 6)

Status: implemented 2026-10-01 on `master`, under the operator's authorisation to implement the redesign end to end. Earlier steps: [shell](2026-10-01-studio-shell.md), [workspace](2026-10-01-studio-workspace.md) and [home](2026-10-01-studio-home.md).

## Outcome

Briefings (`/t/local/p/interview/briefings[/…]`) is the design's two-pane view:

- **Left:** every briefing, newest first. Concept and system-design briefs appear alongside behavioural preparation packs, each labelled with its kind and time. A **+** button starts a new briefing.
- **New briefing:** "What do you need to explain?" with a kind picker (**Concept / System design / Behavioural**) and the placeholder for that kind.
  - Concept and system design use **Build briefing**.
  - Behavioural uses **Start a preparation pack**: behavioural answers are built from the person's experience matrix with linked evidence, so they go to the existing preparation editor.
- **A brief:** a 1:30 "Practise it out loud" timer, **Headline**, **Three points** (numbered), **Example to use** and **Don't say**, **Likely follow-ups** as an accordion, and Delete.

## Routes

| Path | Shows |
|---|---|
| `/briefings` | New briefing |
| `/briefings/brief/<id>` | A concept or system-design brief |
| `/briefings/<packId>` | A behavioural preparation pack (unchanged) |

`StudioActions.openBrief(id)` joins `openBriefing(packId)`. The palette's Briefings group lists both.

## Data and API

- **Contracts.** `@omnitech/interview-contracts` adds `conceptBriefSchema` (v1), containing:
  - headline
  - **exactly three** points `{heading, body}`
  - example, pitfall
  - 1–5 follow-ups `{question, answer}`

  It also adds the request, summary and list schemas.
- **Migration.** `0009_concept_briefs.sql` adds `interview.concept_briefs` (kind, topic, `value jsonb`) with private-scope row-level security.
- **Router.** `createBriefsApi`, a product router mounted at `/api/interview/briefs[/*]`, provides list, read, build (`POST {kind, topic}`) and delete. Writes from other sites are refused (403).
  - The prompt follows the repository's spoken-answer rules: 60–90 seconds, exactly three points, an example that fits the kind, and plain spoken English.
  - The topic is treated as untrusted input.
  - A model reply that does not fit the brief's shape is refused (502) and nothing is stored.
- **Client.** `@omnitech/interview-api-client` adds `createBriefsClient`.

## Finding: strict JSON-schema decoding is too slow on the local model

The first browser attempt sent the brief's JSON Schema as the provider's strict `response_format`. LM Studio's grammar-constrained decoding did not finish within 180 s (reproduced outside the app with the same adapter). The same request with the schema **stated in the system prompt** returned a valid brief in **35 s**.

The briefs API therefore states the schema in its instructions and validates the reply itself with Zod. The gateway still parses JSON and retries once on invalid output.

The behavioural pack generation (from the earlier briefings work) still sends a strict schema and is likely to hit the same slowness on local models. That was left as it is here.

## Frontend

- `studio/briefings/`:
  - `briefings-view` (list, selection from the path, header title)
  - `new-brief`
  - `brief-card`
  - `briefings.css`
- **Shared timer.** `studio/practice-timer.tsx` is shared with the Workspace's Explain stage (2:00 there, 1:30 for briefs).
- **Lists.** `use-studio-lists` also loads concept briefs.
- **Bold headings.** A model's `**…**` around a heading is shown as bold, not as literal asterisks.

## Verification

- `pnpm verify` passed: 558 tests; coverage 91.16% statements, 82.5% branches, 91.12% functions.
- New tests:
  - **briefs API (Postgres):** build, list, read, delete, refusal of an off-shape reply, validation, privacy, cross-site refusal
  - **briefs client:** routes and error codes
  - **Briefings component:** list order, build per kind, errors, behavioural start, brief layout and accordion, delete with confirmation, load failure, path selection
  - **practice timer:** countdown, stop and restart
- **Browser:**
  - a real concept brief was built by the local model in about 40 s and rendered as designed
  - the follow-up accordion switched answers
  - the timer counted down
  - Behavioural opened the preparation editor in the right pane

## Not done

- **Practice time is not recorded.** Rehearsal (sub-project 6) records scored sessions instead.
- **Editing or regenerating a brief.** Neither is offered; build a new one. The assistant cannot edit concept briefs yet: briefs are not assistant-bound drafts.
