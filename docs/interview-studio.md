# Interview Studio

The interview product (`omnitech.interview`) is one app: Interview Studio, served by `apps/web` at `/t/<tenant>/p/interview`. Run it with `pnpm dev`, then open <http://127.0.0.1:3000/t/local/p/interview>.

## Views

| Path | View |
|---|---|
| `/` | **Home:** the upcoming interview, a prep plan with live status, recent runs |
| `/work?artifact=<id>` | **Workspace:** Understand → Plan → Code → Test → Explain; solution, usage and tests run in Docker; autosaved drafts and saved versions |
| `/briefings[/brief/<id> \| /explanations \| /<packId>]` | **Briefings:** spoken concept and system-design briefs, concept explanations pushed from the CLI, behavioural preparation packs ([runbook](interview-briefings.md)) |
| `/knowledge[/<slug>]` | **Knowledge:** the reviewed reference library |
| `/rehearsal` | **Rehearsal:** timed sessions, hints that cost points, checklist and saved scorecard |

The docked assistant (⌘J) reads the open question and proposes changes for review. ⌘K opens the command palette.

## Where it lives

- **`products/interview/src/frontend/studio/`:** the Studio. `StudioPage` (`studio-page.tsx`) is its single entry point, and the views are listed in `config/views.tsx`. `apps/web` renders it for every interview route through `interview-studio-page.tsx`, browser-only (`next/dynamic` with `ssr: false`), so the server build never compiles the Studio. Every API call goes through `studioFetch`, which sends the page's tenant in `x-omnitech-tenant`.
- **`products/interview/src/backend/studio/host.ts`:** `createInterviewStudio`, the product router. It serves the assistant (`/api/assistant/*`), Workspace drafts (`/api/interview/workspaces/*`), the plan, briefs, rehearsals and briefing packs (`/api/interview/*`). It also provides the run `worker` that executes assistant turns.
- **`apps/web/src/platform/interview-studio.ts`:** composes the router on the platform database, AI gateway and Docker runner.
  - **Scope:** each request resolves the signed-in member of the named tenant, and writes need `interview.write`.
  - **Worker:** `instrumentation.ts` runs the worker in the Next.js server process.
- **`packages/platform-storage`:** the migrations, including the assistant's run tables and `0004`–`0010` for the interview tables. Interview and assistant rows are private to tenant, member and product, enforced by row-level security.

## Code highlighting

Markdown code uses Shiki's core build (`frontend/shiki-highlighter.ts`) with a fixed set of languages: TypeScript, TSX, JavaScript, JSX, PHP, Ruby, JSON, bash, SQL, HTML, CSS, YAML, diff, Python and Mermaid. Any other language renders as plain text. Add a language there when answers start using it.

## The assistant's model

The `interview-assistant` profile in `apps/web/src/platform/ai.ts` uses the application's model settings (`AI_*`, `OPENAI_*`, `LM_STUDIO_*`).

- **LM Studio:** with a local LM Studio model, `pnpm dev` loads it with `ASSISTANT_CONTEXT_TOKENS` (default 32,768) of context.
- **Budget:** the assistant keeps a quarter of that context for output, and sizes the history it sends to fit the rest.

## Pushing from the CLI

`interview-answers playground …` and `interview-answers mock-interview …` push into the open studio through `/api/v1/playground-control`. The studio applies each push once:

| Push | Where it lands |
|---|---|
| Question and answer | Opens a Workspace draft; the same question updates that draft |
| Explanations | Briefings › Concept explanations |
| `mock-interview start` / `end` / `reset` | Drives Rehearsal |

A push waits while preparation has unsaved changes or a rehearsal is live. The `interview-playground-controller` skill describes the workflow.
