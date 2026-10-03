# products/interview/src/backend/live-session/session-dispatch.ts

_Source: `products/interview/src/backend/live-session/session-dispatch.ts` (header-comment fallback)_

The fenced dispatch skeleton every action kind shares: record the action,
re-check the session row, make gateway calls, and publish through the fenced
write. `beginDispatch` is the shared front (record, standing, profile) and
the `Dispatch` it returns carries the rest (the gateway call and the
publish), so the prose draft (dispatchTask, below) and the coding path
(coding-path.ts) run the SAME skeleton. Prompt assembly, context selection and
output validation live in service.ts and coding-stage.ts.

Every decision rests on the session row and on validated structured fields
(rule:structured-field-decisions): the processing policy comes from the row
alone (rule:session-processing-policy), never from ingest or model content.

Locality: the gateway refuses a non-device profile for a device-only request
at resolution and again inside the call (rule:device-only-enforced-twice).
This module adds the processor's own re-check: the policy used is re-read
under the fenced-write check immediately before EVERY call and before an
agent job is requested (stillStanding), a stage with no
device implementation is refused in device-only (rule:unlisted-stage-refused)
and there is NEVER a fallback to another profile: a refusal is final, an
unavailable device is a retryable outcome that tries the same profile again.
