# products/interview/src/backend/live-session/processor-rebuild-state.test.ts

_Source: `products/interview/src/backend/live-session/processor-rebuild-state.test.ts` (header-comment fallback)_

A rebuilt run (pause then resume, lease handover) behaves exactly like the
live run did: statements the live run ignored are not judged again against
task state they never saw, and a revision retried after a handover still
carries the whole question. Real processor over a disposable PostgreSQL, a
fake engine and a virtual clock.
