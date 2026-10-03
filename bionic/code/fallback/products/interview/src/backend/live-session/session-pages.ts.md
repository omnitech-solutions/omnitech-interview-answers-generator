# products/interview/src/backend/live-session/session-pages.ts

_Source: `products/interview/src/backend/live-session/session-pages.ts` (header-comment fallback)_

Cursor-paged owner reads for the Studio Live view: the owner's session
history (newest first) and the session's action changes (every action
created or changed after a cursor). Both are keyset pages over
(timestamp, id), read in the owner's actor scope, so another same-tenant
user finds nothing (rule:owner-checked-read-paths). Nothing here selects
transcript, draft or answer content except the action result the stream
already returns to its owner.
