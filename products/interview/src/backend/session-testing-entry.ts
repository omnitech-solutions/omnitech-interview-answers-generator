// Backend-only subpath `@omnitech/product-interview/session-testing`: TEST
// SUPPORT for hosts that drive the REAL session processor over their own
// gateway without a database (the agent worker's end-to-end tests). Nothing
// here is used by a production host. It exports only what
// apps/agent-worker/src/session-e2e-support.ts imports; widen it only when a
// host test needs more.
export { createMemorySessionWorld } from "./live-session/memory-session-world.js";
export { createInterviewSessionPolicy } from "./live-session/interview-policy.js";
export { createSessionProcessor } from "./live-session/processor.js";
export type { SessionProcessorOptions } from "./live-session/processor-ports.js";
export type { SessionTraceEvent } from "./live-session/trace.js";
// Types only, and only so the host's harness type (which embeds the world's
// ports and rows) can be named in its declaration emit.
export type {
  SessionClaimPort,
  SessionStorePort,
} from "./live-session/processor-ports.js";
export type {
  StoredAction,
  StoredObservation,
} from "./live-session/session-reads.js";
