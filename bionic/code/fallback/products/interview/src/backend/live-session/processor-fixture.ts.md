# products/interview/src/backend/live-session/processor-fixture.ts

_Source: `products/interview/src/backend/live-session/processor-fixture.ts` (header-comment fallback)_

Test support for the session processor suites: a fake engine that returns
canned closed-schema output (and can be held mid-call), a trace collector, a
replay helper that ingests the synthetic fixtures through the real ingest
path, and a world that composes the real processor over the database
fixture. Tests, not production code, import this.
