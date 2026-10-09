# apps/agent-worker/src/coach-replay.test.ts

_Source: `apps/agent-worker/src/coach-replay.test.ts` (header-comment fallback)_

The replay command, run as it is run by hand: as its own process, against
an invented transcript in a temporary directory. The command is a script
(top-level await, `process.exit`), so it is never imported here.

It is started with the worker's own `tsx`, as `pnpm coach:replay` starts
it, and like every suite of this app it reads the interview product as
built (`@omnitech/product-interview/session-worker`). Timing only: no model
is called and nothing leaves the process.
