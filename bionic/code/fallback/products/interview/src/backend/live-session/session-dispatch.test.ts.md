# products/interview/src/backend/live-session/session-dispatch.test.ts

_Source: `products/interview/src/backend/live-session/session-dispatch.test.ts` (header-comment fallback)_

The draft-answer dispatch streams: the draft's text so far is read out of
the JSON the model is still writing (partialDraft) and recorded on the
action (recordProgress) while the call runs; every other stage waits for
execute(). In-memory world, no database.
