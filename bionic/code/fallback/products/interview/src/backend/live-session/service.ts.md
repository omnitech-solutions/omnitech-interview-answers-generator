# products/interview/src/backend/live-session/service.ts

_Source: `products/interview/src/backend/live-session/service.ts` (header-comment fallback)_

The session assistance service (plan #2 D4): everything between "a task
revision needs an answer" and "a validated, publishable result" that is not
the fenced record/standing/publish skeleton of session-dispatch.ts. It owns
- the pinned context (loaded once per run through the store port, bounded
and cached on the run: a new fence builds a new run and reloads, and the
pinned profile revision cannot change inside a session);
- prompt assembly and the device window (the stage refuses, never
truncates, an oversize prompt);
- validation of the closed output and per-claim verification;
- the shape of the published result and its id-and-count-only trace detail.

Nothing here calls a model or writes: the dispatcher does both, so the
fenced skeleton reads top to bottom. A coding category is only RECORDED here
(result.category and result.codingBrief); the coding path is a separate
action kind built on that result.
