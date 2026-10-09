# apps/agent-worker/src/coach-fixture.ts

_Source: `apps/agent-worker/src/coach-fixture.ts` (header-comment fallback)_

Writes a call fixture's transcript from its script.

pnpm coach:fixture panel-round

A fixture is a folder under fixtures/calls/. One that has a script.json has
its transcript.txt made from it here; a test fails when the two differ.
