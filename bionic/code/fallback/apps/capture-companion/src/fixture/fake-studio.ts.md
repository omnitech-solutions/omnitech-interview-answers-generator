# apps/capture-companion/src/fixture/fake-studio.ts

_Source: `apps/capture-companion/src/fixture/fake-studio.ts` (header-comment fallback)_

A scripted stand-in for Studio's ingest route: it records every request and
answers with well-formed acknowledgements, so a companion can be exercised
with no server. It mirrors the route's behaviour only as far as the
companion depends on it (acknowledge, refuse, control state, outage).
