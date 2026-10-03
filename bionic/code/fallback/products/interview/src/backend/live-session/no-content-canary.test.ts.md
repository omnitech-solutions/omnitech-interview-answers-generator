# products/interview/src/backend/live-session/no-content-canary.test.ts

_Source: `products/interview/src/backend/live-session/no-content-canary.test.ts` (header-comment fallback)_

The no-content canary (rule:id-only-traces, rule:credential-storage,
objective constraint: never log questions, transcripts, screenshots, prompts,
generated content or credentials). One unique string is planted in a final
transcript, in screenshot metadata, in a credential and in error paths, and
is carried through ingest over the routes, dispatch by the real processor on
a fake gateway, a failing dispatch, and the purge. The test then proves the
string is absent from every console line, every trace event, every error or
control response and the purge's tombstone - while the owner's own stream
still holds it, so the plant is known to have reached storage.
