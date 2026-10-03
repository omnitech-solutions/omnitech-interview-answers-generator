# products/interview/src/backend/live-session/coding-path.ts

_Source: `products/interview/src/backend/live-session/coding-path.ts` (header-comment fallback)_

The coding path (plan #2 D6): the second action kind of a coding task. A
published prose draft that named the task a coding challenge makes this action
owed for the same task revision; it runs on the SAME fenced dispatch skeleton
(beginDispatch: record, standing check, profile), then
1. one structured gateway call for the solution (closed schema, no tools);
2. the tests, run through the host's CodeRunner with empty stdin, plus a
syntax check when the runner offers one;
3. when the tests fail, ONE direct repair attempt: a second gateway call
that carries only the failing report's test names and statuses;
4. the three distinct states (code-states.ts) derived from what the runner
actually reported;
5. a fenced publish whose effect writes the session-owned Workspace draft
in the same transaction, behind the expected-revision check
(session-drafts.ts).
A runner that is absent or unavailable never blocks the solution: it
publishes as generated with testsPassed false and the reason
`runner_unavailable` - it never claims tests passed. The prose draft never
waits for any of this: it is a separate action that dispatches first, and at
most one model call per session is in flight.
