# products/interview/src/backend/live-session/ingest.ts

_Source: `products/interview/src/backend/live-session/ingest.ts` (header-comment fallback)_

Ingest moved to services/ingest.service.ts (the use case), handlers/ (one
per message kind), domain/ (the decisions), repositories/ (the SQL) and
infrastructure/event-publisher.ts (what is told after the commit). This file
keeps the old import path for the modules and suites that name it.
