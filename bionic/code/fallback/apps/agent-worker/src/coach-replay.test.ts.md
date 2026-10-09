# apps/agent-worker/src/coach-replay.test.ts

_Source: `apps/agent-worker/src/coach-replay.test.ts` (header-comment fallback)_

The replay command, run as it is run by hand: as its own process, against
an invented transcript in a temporary directory. The command is a script
(top-level await, `process.exit`), so it is never imported here.

It is started with the worker's own `tsx`, as `pnpm coach:replay` starts
it, and like every suite of this app it reads the interview product as
built (`@omnitech/product-interview/session-worker`). Timing only: no model
is called and nothing leaves the process.

By default a replay tells the coach who is speaking, from the recording's
own timings (a piece begun and not yet ended); `--no-activity` leaves the
coach with the text alone. Both are run here, over the same files.
