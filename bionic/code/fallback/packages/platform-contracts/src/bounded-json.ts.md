# packages/platform-contracts/src/bounded-json.ts

_Source: `packages/platform-contracts/src/bounded-json.ts` (header-comment fallback)_

A request body is untrusted input: it is counted while it streams, so an
oversize body is refused before it is buffered whole or parsed, whatever
content-length claims (or omits). Refusals carry no request content.
