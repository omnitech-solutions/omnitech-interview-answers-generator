# apps/capture-companion/src/companion.ts

_Source: `apps/capture-companion/src/companion.ts` (header-comment fallback)_

The companion loop: pairing check, capture, a bounded outbox with resend,
control pull on the heartbeat, and the stops. It speaks only the versioned
wire (active-session-contracts), holds no database or provider credential,
logs nothing, and can only narrow its sources (ADR-0011, ADR-0012).
