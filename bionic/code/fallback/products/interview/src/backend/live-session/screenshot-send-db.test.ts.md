# products/interview/src/backend/live-session/screenshot-send-db.test.ts

_Source: `products/interview/src/backend/live-session/screenshot-send-db.test.ts` (header-comment fallback)_

The per-session "Screenshots to the model" setting (D35), on a disposable
PostgreSQL as the member role (requires Docker, like the other session
suites): the real processor and assist stage run over a scripted fake
gateway. Asserts counts, ids, names, wire shapes and marker wording only;
the on-screen text is a unique marker that must never reach a trace or log.
