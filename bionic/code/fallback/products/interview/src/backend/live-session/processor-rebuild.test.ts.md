# products/interview/src/backend/live-session/processor-rebuild.test.ts

_Source: `products/interview/src/backend/live-session/processor-rebuild.test.ts` (header-comment fallback)_

A run is rebuilt from the stored observations and actions whenever its
session is paused and resumed or its lease changes hands. The rebuilt run must
name every question as the last one did (M2): an answered question is not
dispatched or published again, and a question nobody answered yet is still
answered, exactly once. Real processor over a disposable PostgreSQL, a fake
engine and a virtual clock.
