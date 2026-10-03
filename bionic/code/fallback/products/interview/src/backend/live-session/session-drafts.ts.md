# products/interview/src/backend/live-session/session-drafts.ts

_Source: `products/interview/src/backend/live-session/session-drafts.ts` (header-comment fallback)_

The session-owned Workspace draft (plan #2 D6, ADR-0012 complete purge).

A tested coding solution lands in ONE Workspace draft per task, in the
workspace `active-session:<sessionId>`, written INSIDE the fenced publish
transaction so the draft and the action result commit or roll back together.
The write uses InterviewWorkspaceRepository semantics - drafts are optimistic
by revision - and an EXPECTED-REVISION CHECK keeps a late AI result from
overwriting newer edits: the session remembers the draft revision it last
wrote (kept in the previous revision's action result, read in the same
transaction). If the stored draft is at any other revision the owner edited
it, so the result is NOT written; it stays on the action as a held result and
`workspace: {published: false, conflict: true}` says so. A conflict is an
outcome, never an exception: throwing would strand the action in flight.

Provenance marks the draft as session-created (proposalId `session:<id>`). An
answer, briefing or question edit clears provenance (workspace.ts
editTransaction) but a notes or progress edit does not, so the purger also
compares the draft's revision with the one the session last wrote: it deletes
only drafts still byte-for-byte the session's own and that no saved answer
revision refers to.

The Workspace repository speaks string-query transactions; the fenced write
holds a Drizzle transaction. `workspaceTransaction` adapts one to the other:
it rebinds each `$n` placeholder as a Drizzle parameter, so values stay bound
parameters (never concatenated) on the same connection and transaction.
