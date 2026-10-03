// Backend-only subpath `@omnitech/product-interview/session-worker`: the
// Active Session processor's worker-side entrypoint (ADR-0011). The agent
// worker imports this and nothing from the frontend or Next.js.
export * from "./live-session/worker-entry.js";
