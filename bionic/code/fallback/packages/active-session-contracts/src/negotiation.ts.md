# packages/active-session-contracts/src/negotiation.ts

_Source: `packages/active-session-contracts/src/negotiation.ts` (header-comment fallback)_

Wire negotiation (ADR-0020). The acknowledgement objects are strict, so a new
field is not additive for a reader that does not know it. A companion
therefore DECLARES what it understands on every ingest request, in headers
outside the strict bodies (an older Studio ignores them, so a newer companion
still works against it), and Studio emits a field an older reader would
reject only to a companion that declared it.
x-companion-features: space- or comma-separated feature tokens
x-companion-screen:   the companion's opaque token for the screen source it
has selected (display identity plus selection
generation); changes whenever the selection does
