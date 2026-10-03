# products/interview/src/frontend/studio/live/use-companion-capability.ts

_Source: `products/interview/src/frontend/studio/live/use-companion-capability.ts` (header-comment fallback)_

Reads the companion's last capability report (GET .../companion-capability).
A read that fails keeps what was last read; with nothing read it is "error",
which no screen turns into a claim. `refreshMs` re-reads on an interval (the
report changes when the companion starts, after the panel is already open).
