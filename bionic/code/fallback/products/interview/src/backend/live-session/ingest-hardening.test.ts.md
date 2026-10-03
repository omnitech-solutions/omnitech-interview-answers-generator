# products/interview/src/backend/live-session/ingest-hardening.test.ts

_Source: `products/interview/src/backend/live-session/ingest-hardening.test.ts` (header-comment fallback)_

Ingest hardening on a disposable PostgreSQL as the member role (PB-0002 dev
loop 4): a transcript source label is checked against the session's permitted
sources; the same source and event id with different content is an
event_conflict that never overwrites; heartbeats and capability reports are
bounded by minimum spacing; and a capability report is stored as the owner's
latest device capability, content-free and surviving a session purge.
