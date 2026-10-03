# products/interview/src/backend/live-session/escalation.test.ts

_Source: `products/interview/src/backend/live-session/escalation.test.ts` (header-comment fallback)_

Escalation to an agent job (plan #2 D7): a job exists ONLY when the validated
structured field asks for it ("repository-navigation", or "iterative-repair"
after one direct repair attempt failed its tests) in a permitted-remote
session; the action naming the reserved id commits before the job exists; the
job is the owner's private job carrying a typed profile and a payload
reference only; pause cancels it; device-only, an enum of "none", free text
and an output outside the closed schema never create one. The job repository
is the real PostgresAgentJobRepository on the disposable database.
