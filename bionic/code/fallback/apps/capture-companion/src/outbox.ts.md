# apps/capture-companion/src/outbox.ts

_Source: `apps/capture-companion/src/outbox.ts` (header-comment fallback)_

A bounded, in-memory outbox. Every observation gets a stable
(sourceId, eventId, sequence) at creation and keeps it across every resend,
so Studio can deduplicate (rule:idempotent-observation). Nothing is written
to disk: a stopped or crashed companion simply loses unsent buffers.
