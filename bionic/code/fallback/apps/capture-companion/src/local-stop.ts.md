# apps/capture-companion/src/local-stop.ts

_Source: `apps/capture-companion/src/local-stop.ts` (header-comment fallback)_

LOCAL STOP (rule:offline-local-stop). It is local-first: synchronous, no
network, final for the run. Everything that matters happens before the
function returns; only then does it make a best-effort attempt to
tell Studio, and a Studio that is down changes nothing.
