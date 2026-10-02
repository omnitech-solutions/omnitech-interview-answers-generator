# Interview Studio Home (redesign sub-project 3 of 6)

Status: implemented 2026-10-01 on `master`, under the operator's authorisation to implement the redesign end to end. Earlier steps: [shell](2026-10-01-studio-shell.md) and [workspace](2026-10-01-studio-workspace.md).

## Outcome

Home (`/t/local/p/interview`) is the design's dashboard:

- **Greeting with a countdown**, e.g. "7 days until your Northwind interview. Here's what's left."
- **Upcoming interview card:** company · role, date and time · duration · format, topic chips, and a prep-plan progress bar. "Edit" changes it in place; with no interview yet, the card is an "Add your next interview" form.
- **Prep plan:** items to tick off. Each one links to a question, briefing or rehearsal (or is a plain task) and shows **live status from that work**, e.g. "6 of 7 tests passing" or "Saved". Items can be opened, ticked, removed, and added from your questions, your briefings, "A timed rehearsal" or free text.
- **Continue:** your questions with language, the **latest test run** ("5 / 6 tests", "Passed", "In progress") and a relative time. The sidebar's recent-question dots take their colour from the same run.

## Data

**Migration** `0008_interview_plans.sql` adds two tables with private-scope row-level security (tenant, actor, product), following 0006:

- `interview.interview_plans`: id, company, role, `scheduled_at`, `duration_minutes`, format, `topics jsonb`
- `interview.interview_plan_items`:
  - kind ∈ question / briefing / rehearsal / task
  - `ref` (the linked artifact id), title, done, position
  - a foreign key to its plan, cascading on delete

Plan items **store a link, never a copy**. Their status is computed when the plan is read:

| Item | Status |
|---|---|
| question | From `InterviewWorkspaceRepository.listDrafts`, which now returns each draft's `lastRun`: the latest completed `run-code` receipt, summarised as `{ok, passed, total, at}` |
| briefing | Saved or still a draft, from `BriefingRepository.listArtifacts` |
| rehearsal | Via an injected `rehearsalStatus` (wired up in sub-project 6) |
| task | None |

The **current interview** is the next one still ahead (today counts); otherwise it is the most recently edited.

## API

- **Router.** `createPlanApi`, a product Hono router exported from `@omnitech/product-interview/backend`, is mounted by the assistant host at `/api/interview/plan[/*]`. It has one route per change:
  - `GET` (the plan)
  - `PUT /interview` (create when there is no id; update otherwise)
  - `POST /items`, `PATCH /items/:id`, `DELETE /items/:id`

  Every call returns the whole plan.
- **Validation and errors.** Inputs are validated with the new `interview-contracts` plan schemas. Invalid input returns 400, unknown ids 404, and no scope 401.
- **Cross-site protection.** Writes from another site are refused: a `sec-fetch-site: cross-site` header or a foreign `Origin` returns 403.
- **Client.** `@omnitech/interview-api-client` adds `createPlanClient`, which owns the HTTP paths.
- **Host.** The assistant host applies migration 0008 and grants DELETE on plan items to its local role.

## Frontend

- `studio/home/`: `home-view`, `interview-card` (view and form), `plan-card` (list and add menu), `use-plan`, `home.css`.
- `studio/run-status.ts`: one reading of a run, shared by Continue and the sidebar dots.
- The interim `studio/home-view.tsx` from sub-project 1 is removed.
- **Narrow windows.** The cards stack, and Continue keeps only the title and status below 900px.

## Verification

- `pnpm verify` passed: 542 tests; coverage 91.03% statements, 82.08% branches, 90.98% functions.
- New tests:
  - Postgres: the plan API (create, update, items with live statuses, ordering, tick, remove, privacy, cross-site refusal, next interview ahead) and `lastRun` in `listDrafts`
  - the plan client
  - Home component tests
- **Browser** (operator's Chrome):
  - Home showed real run statuses ("6 / 7 tests", "5 / 6 tests", "In progress") and matching sidebar dots
  - added the Northwind interview with a real form, giving the countdown "7 days until…"
  - added a question (live "6 of 7 tests passing"), a rehearsal and a typed task
  - ticking the task moved progress to "1 / 3"
  - "Open" went to the linked question, and Back returned Home with the plan intact
- **Dev note.** Vite caches failed module lookups for packages' `dist`. A file added after the dev server started (here `run-status.js`) was not found until the server restarted, which touching `apps/frontend/vite.config.ts` does.

## Not done

- **Assistant-suggested plan items** need the assistant host to be able to send a message. Items are added by hand.
- **Plan items cannot be reordered** in the UI; new items go to the end.
