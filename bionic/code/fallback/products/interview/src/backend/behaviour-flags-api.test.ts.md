# products/interview/src/backend/behaviour-flags-api.test.ts

_Source: `products/interview/src/backend/behaviour-flags-api.test.ts` (header-comment fallback)_

The behaviour flags over HTTP: the Settings pane and the agent worker read
them, Settings changes them, and a flag the host set in the environment is
reported as such and cannot be changed. The store here is the real one over
a temporary file, never the data directory; its environment is the test's
own, so the machine's variables decide nothing.
