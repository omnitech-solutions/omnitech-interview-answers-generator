// Backend-only subpath `@omnitech/product-interview/session-worker`: the
// Active Session processor's worker-side entrypoint (ADR-0011). The agent
// worker imports this and nothing from the frontend or Next.js.

// The live coach the worker runs beside the session loop.
export * from "./coach/index";
// A person's material read from files, for a recorded call replayed through
// the coach with its context pack (`pnpm coach:replay --matrix … --brief …`).
export {
  type ReplayMaterial,
  ReplayMaterialError,
  type ReplayMaterialPaths,
  readReplayMaterial,
} from "./context-pack/eval/replay-material";
export * from "./live-session/worker-entry";
