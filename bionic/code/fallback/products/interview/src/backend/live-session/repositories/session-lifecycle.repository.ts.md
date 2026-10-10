# products/interview/src/backend/live-session/repositories/session-lifecycle.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/session-lifecycle.repository.ts` (header-comment fallback)_

Persistence of the owner-facing session lifecycle: the link checks of a
start, the one-open-session lookup, the insert, and the credential, policy,
screenshot-send and retention writes. No decisions here: the use-case module
(repository.ts) decides, this file reads and writes. Every statement is raw
and moved verbatim from there, so the SQL semantics are unchanged.
