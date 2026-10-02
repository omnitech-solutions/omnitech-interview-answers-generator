# Playground control in Interview Studio

Status: implemented 2026-10-02 on `master`. This follows the removal of the legacy Workspace, which was the only screen that showed this channel.

## What the channel is

Agents push interview material with `interview-answers playground …` and `interview-answers mock-interview …`, as routed by `CLAUDE.md` and the `interview-playground-controller` skill.

- The API keeps the latest push in memory at `/api/v1/playground-control`. Each push has a revision, and patches merge into the stored value.
- The open app follows those revisions.

## What Interview Studio does with a push

The shell follows the channel in `usePlaygroundControl`. It polls every 500 ms while the tab is visible, as the old Workspace did, and applies each new revision once. `planControl` decides what changed since the last revision applied in this browser; that record is kept in localStorage, so a reload never applies a push twice.

| Pushed | Studio |
|---|---|
| `question` / `answer` / `notes` | **New question:** opens a new Workspace draft (`q-…`), written through the canonical draft API. **Same question:** updates the draft it opened, and an open copy reloads unless you have unsaved edits. |
| `view: playground` | Workspace (the draft above) |
| `view: concept-lab` | Briefings › Concept explanations (`/briefings/explanations`) |
| `view: interview-preparation` | Briefings |
| `view: mock-interview` | Rehearsal |
| `explanation(s)`, `append-explanation` | The Concept explanations list in Briefings. The first starts open and follow-ups start collapsed. |
| `mock-interview start [--strict]` / `end` / `reset` | Rehearsal starts with the chosen questions, scores the live session, or returns to setup. Each command runs once. |
| `panel`, `language` without an answer | Accepted, not shown |
| `playground reset` | Nothing to show, so the Studio stays where it is |

### Guards

- A push waits while interview preparation has unsaved changes.
- A push also waits while a rehearsal is live, unless it is a rehearsal command.

### Failures

- **Draft refused:** a draft the server refuses is not retried on every poll. `playground show` still has the push.
- **Channel missing:** the Studio carries on.

## Wiring

- **`apps/api`:** mounts `/api/v1/playground-control[/*]` on `createInterviewApi`, ahead of the `/api/v1` refusal. The host binds only to 127.0.0.1.
- **CLI:** the playground commands default to `http://127.0.0.1:5175`, the Studio host. `--url`, `INTERVIEW_API_URL` and the config file still take precedence. Help text names the Studio views.
- **`.rulesync`:** the controller skill and the mock-interview commands describe where each push appears. The generated outputs are regenerated.

## Verification

- **Unit tests:**
  - the plan: new or the same draft, panel-only patches, view mapping, explanations, rehearsal commands run once, empty pushes
  - storage, including blocked storage
  - draft writes and failures
- **Shell tests:** a pushed question opens a Workspace draft; pushed explanations show in Briefings; a push waits during unsaved preparation.
- **Rehearsal test:** start, end and reset run once each.
- **Workspace test:** only the matching open draft reloads.
- **Live, with the real CLI against the Studio:**
  - `set --file` opened a new draft with its code and tests
  - a second question opened another draft
  - `append-explanation` ×2 rendered the first open and the follow-up collapsed
  - `mock-interview start --strict` started a strict session
  - `reset` returned to setup
