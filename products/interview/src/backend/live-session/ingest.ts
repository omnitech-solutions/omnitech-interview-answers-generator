// Ingest moved to services/ingest.service.ts (the use case), handlers/ (one
// per message kind), domain/ (the decisions), repositories/ (the SQL) and
// infrastructure/event-publisher.ts (what is told after the commit). This file
// keeps the old import path for the modules and suites that name it.
export type { HeardLine } from "./contracts/events";
export type { IngestOptions } from "./contracts/ingest";
export { ingestObservation } from "./services/ingest.service";
