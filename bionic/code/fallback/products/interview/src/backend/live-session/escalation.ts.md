# products/interview/src/backend/live-session/escalation.ts

_Source: `products/interview/src/backend/live-session/escalation.ts` (header-comment fallback)_

Escalation to an agent job (plan #2 D7, ADR-0011 rule:structured-field-
decisions, ADR-0012 rule:job-creation-locked-to-session / rule:action-before-
job). The fast path never gives a model a tool: the solution call returns a
closed enum "escalation", and ONLY this module decides, from that validated
field and from facts the processor observed, whether a job is created:

- the field says "repository-navigation": the task needs a codebase the
session was not given; or
- the field says "iterative-repair" AND one direct repair attempt already
ran and failed its tests (a runner reported them); and
- the session's processing policy, read from the session row, is
permitted-remote. Device-only never creates a job.

Anything else - free text that merely says "run an agent", a field outside
the closed schema, an unconfigured host - creates nothing.

The job is created through createSessionJob after the action row that names
its reserved id is committed (action-before-job), under a lock that
re-verifies the session is active and the holder current. What the job is
allowed to do is a typed, versioned, bounded agent profile chosen by the host
by the validated kind; the job carries a payload REFERENCE only - no raw CLI
arguments, environment variables, directories, MCP servers or permission
bypasses are expressible, and a person or a model cannot supply any.

DEFERRED HAND-OFF: this loop only creates and records the job. Whatever the
job later produces stays untrusted until a later fenced publish (a result
publisher is built in a later loop); nothing here reads it, and a pause or end
cancels the job through the same actions that name it.
