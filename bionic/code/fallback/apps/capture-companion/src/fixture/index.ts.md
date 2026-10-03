# apps/capture-companion/src/fixture/index.ts

_Source: `apps/capture-companion/src/fixture/index.ts` (header-comment fallback)_

The fixture companion: the public entrypoint for tests that need a real
companion without a Mac. It is the whole companion loop over injected fakes
(fetch, capture, speech capability, clock); only the platform is faked.
