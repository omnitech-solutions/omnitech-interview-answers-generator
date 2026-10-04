# products/interview/src/backend/live-session/session-run-slots.test.ts

_Source: `products/interview/src/backend/live-session/session-run-slots.test.ts` (header-comment fallback)_

A slot's child abort follows the run's abort only while its dispatch is
live: settling the slot detaches it, so a long-lived run does not gather one
listener per dispatch (ADR-0016). No database.
