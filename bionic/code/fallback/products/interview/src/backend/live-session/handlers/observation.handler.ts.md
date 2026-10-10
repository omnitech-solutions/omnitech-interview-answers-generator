# products/interview/src/backend/live-session/handlers/observation.handler.ts

_Source: `products/interview/src/backend/live-session/handlers/observation.handler.ts` (header-comment fallback)_

An observation (a final transcript, a screenshot, a disconnect, a capture
gap): validated, checked against the session's sources and bounds, deduped
by source and event id, then stored with its acknowledgement. A resend
returns the ORIGINAL stored acknowledgement (rule:idempotent-observation);
the same ids with different content is a conflict and never an overwrite.
