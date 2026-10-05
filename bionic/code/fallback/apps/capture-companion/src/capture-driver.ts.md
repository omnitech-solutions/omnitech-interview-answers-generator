# apps/capture-companion/src/capture-driver.ts

_Source: `apps/capture-companion/src/capture-driver.ts` (header-comment fallback)_

The platform's capture, behind the smallest possible port: start and stop
named sources, and capture ONCE on request. Stopping is synchronous and
needs no network, which is what lets a local stop work while Studio is down.
