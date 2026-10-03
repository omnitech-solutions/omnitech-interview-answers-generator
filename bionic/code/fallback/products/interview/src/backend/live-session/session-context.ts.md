# products/interview/src/backend/live-session/session-context.ts

_Source: `products/interview/src/backend/live-session/session-context.ts` (header-comment fallback)_

The database reader of a session's approved context (ADR-0011/0012, plan #2
D5): the pinned candidate-profile revision, the linked briefing draft's
employer material and the candidate's own preferences, assembled into one
ContextSnapshot. Everything is read in an owner-scoped transaction (forced
row security binds the actor), so another same-tenant user's profile or
draft reads as absent (rule:owner-checked-read-paths,
rule:linked-resource-authorization).

A pinned profile that cannot be read, whose matrix no longer parses, or
whose bytes no longer hash to the sha256 recorded at pin time is NOT replaced
by a stale or partial answer: the context is unavailable, a coded failure the
dispatcher records as retryable (the context fails closed). A session with no pinned
profile has a snapshot with profile null: the stage still answers with
interpretation and general knowledge, and no matrix-backed claim can verify.

Errors carry a code only, never content.
