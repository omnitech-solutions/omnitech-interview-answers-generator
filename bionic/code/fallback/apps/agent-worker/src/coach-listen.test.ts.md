# apps/agent-worker/src/coach-listen.test.ts

_Source: `apps/agent-worker/src/coach-listen.test.ts` (header-comment fallback)_

The listen command, run as an agent runs it by hand: as its own process,
against a tiny local server standing in for the Studio's coach transcript,
coach plan and the pen (who may write the notes). The command is a script (top-level await, `process.exit`),
so it is never imported here. Every line said is invented, and the token is
a made-up one that only this stand-in knows.

The command keeps where it read to in `.dev-local/coach-listen.json` in the
repository. Whatever that file held before the suite is put back after it
(or the file is removed when there was none), so a run leaves no trace.
