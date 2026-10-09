# API surface

_Static route scan (Express/Fastify verb calls + NestJS decorators, labeling GraphQL resolvers as a residual rather than reading them); the app is not executed._

## Routes (93)

| method | path | handler |
|---|---|---|
| ALL | `/api/assistant/*` | — |
| ALL | `/api/interview/*` | — |
| DELETE | `/api/v1/answers/:id` | — |
| DELETE | `/api/v1/coach-notes` | — |
| DELETE | `/api/v1/coach-transcript` | — |
| DELETE | `/api/v1/coach-writer` | — |
| DELETE | `/api/v1/explanations/:id` | — |
| DELETE | `/api/v1/library/items/:id` | — |
| DELETE | `/api/v1/playground-control` | — |
| DELETE | `/platform/v1/agent-jobs/:id` | — |
| DELETE | `/presentation/v1/documents/:id` | — |
| DELETE | `/presentation/v1/documents/:id/slides/:slideId` | — |
| DELETE | `/presentation/v1/shares/:id` | — |
| GET | `/:workspace/artifacts` | — |
| GET | `/api/auth/csrf` | — |
| GET | `/api/auth/session` | — |
| GET | `/api/boom` | — |
| GET | `/api/fake/v1/models` | — |
| GET | `/api/native-auth/complete` | — |
| GET | `/api/platform/v1/ai-targets` | — |
| GET | `/api/platform/v1/context` | — |
| GET | `/api/platform/v1/products` | — |
| GET | `/api/read` | — |
| GET | `/api/teapot` | — |
| GET | `/api/v1/answers` | — |
| GET | `/api/v1/answers/:id` | — |
| GET | `/api/v1/coach-ledger` | — |
| GET | `/api/v1/coach-notes` | — |
| GET | `/api/v1/coach-plan` | — |
| GET | `/api/v1/coach-transcript` | — |
| GET | `/api/v1/explanations` | — |
| GET | `/api/v1/explanations/:id` | — |
| GET | `/api/v1/health` | — |
| GET | `/api/v1/library/facets` | — |
| GET | `/api/v1/library/items` | — |
| GET | `/api/v1/library/items/:idOrSlug` | — |
| GET | `/api/v1/library/search` | — |
| GET | `/api/v1/playground-control` | — |
| GET | `/companion-capability` | — |
| GET | `/current` | — |
| GET | `/platform/v1/agent-jobs/:id` | — |
| GET | `/platform/v1/agent-jobs/:id/events` | — |
| GET | `/platform/v1/agent-profiles` | — |
| GET | `/presentation/v1/documents` | — |
| GET | `/presentation/v1/documents/:id` | — |
| GET | `/presentation/v1/documents/:id/recordings` | — |
| GET | `/presentation/v1/images` | — |
| GET | `/presentation/v1/shared/:token` | — |
| GET | `/presentation/v1/themes` | — |
| GET | `/sign-in` | — |
| GET | `/unrelated` | — |
| PATCH | `/api/v1/playground-control` | — |
| PATCH | `/presentation/v1/documents/:id` | — |
| PATCH | `/presentation/v1/documents/:id/slides/:slideId` | — |
| POST | `/api/auth/callback/local` | — |
| POST | `/api/fake/v1/chat/completions` | — |
| POST | `/api/v1/answers` | — |
| POST | `/api/v1/coach-activity` | — |
| POST | `/api/v1/coach-notes` | — |
| POST | `/api/v1/coach-transcript` | — |
| POST | `/api/v1/coach-writer` | — |
| POST | `/api/v1/explain` | — |
| POST | `/api/v1/explanations` | — |
| POST | `/api/v1/generate` | — |
| POST | `/api/v1/library/items` | — |
| POST | `/api/v1/library/items/:id/archive` | — |
| POST | `/api/v1/library/items/:id/publish` | — |
| POST | `/api/v1/playground-control/explanations` | — |
| POST | `/api/v1/react-preview` | — |
| POST | `/api/v1/route` | — |
| POST | `/api/v1/run` | — |
| POST | `/api/v1/run-all` | — |
| POST | `/api/v1/syntax-check` | — |
| POST | `/platform/v1/agent-jobs` | — |
| POST | `/platform/v1/agent-jobs/:id/resume` | — |
| POST | `/presentation/v1/documents` | — |
| POST | `/presentation/v1/documents/:id/duplicate` | — |
| POST | `/presentation/v1/documents/:id/exports` | — |
| POST | `/presentation/v1/documents/:id/recordings` | — |
| POST | `/presentation/v1/documents/:id/shares` | — |
| POST | `/presentation/v1/documents/:id/slides/generate` | — |
| POST | `/presentation/v1/generate/outline` | — |
| POST | `/presentation/v1/images` | — |
| POST | `/presentation/v1/images/generate` | — |
| POST | `/presentation/v1/themes` | — |
| POST | `/presentation/v1/themes/import` | — |
| PUT | `/api/platform/v1/preferences` | — |
| PUT | `/api/v1/coach-ledger` | — |
| PUT | `/api/v1/coach-plan` | — |
| PUT | `/api/v1/library/items/:id` | — |
| PUT | `/presentation/v1/documents/:id/favorite` | — |
| PUT | `/presentation/v1/documents/:id/slides` | — |
| PUT | `/presentation/v1/themes/:id/:reaction` | — |

## Residuals

- 10 route declarations dropped: the path is composed at runtime and has no static value, and the application is not executed, so no path is rendered for them (a named residual) — `products/interview/src/backend/live-session/hardening/cross-user.test.ts` lines 118, 123, 141, 142, 154, 208, 211, 217, 247; `products/interview/src/backend/live-session/hardening/world.ts` line 178.
