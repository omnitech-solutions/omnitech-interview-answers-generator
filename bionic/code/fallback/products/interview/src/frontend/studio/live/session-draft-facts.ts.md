# products/interview/src/frontend/studio/live/session-draft-facts.ts

_Source: `products/interview/src/frontend/studio/live/session-draft-facts.ts` (header-comment fallback)_

What a session's Workspace draft is made of, read from the session's tasks.
Pure: the Workspace panel renders these and decides nothing itself.

Two results can exist for one task, and they are never mixed up:
written  the solution the session wrote INTO the draft (a published result
whose workspace outcome says `published: true`);
held     a newer solution the session did not write because the owner had
edited the draft (`published: false, conflict`). It lives only on
the action; the owner may take it as a suggestion.
The three code states (generated, tests passed, fully verified) belong to
the result they were computed for, so each is reported with its own result.
