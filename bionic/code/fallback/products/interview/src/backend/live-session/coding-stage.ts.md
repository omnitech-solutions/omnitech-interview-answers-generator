# products/interview/src/backend/live-session/coding-stage.ts

_Source: `products/interview/src/backend/live-session/coding-stage.ts` (header-comment fallback)_

The coding stage: the SECOND action kind a coding task makes (plan #2 D6).
After the prose draft names the task a coding challenge, this stage asks for
a structured solution - code, tests, which test covers which stated
constraint, and whether the model thinks it needs more than a direct attempt
to finish. The prose draft never waits for it.

Same posture as the assist stage (ADR-0011 fast path):
- the policy text is constant; the captured lines, the restated brief and any
earlier solution travel only inside labelled, JSON-encoded DATA blocks
(rule:captured-input-untrusted) - the brief is itself derived from captured
speech, so it is untrusted too;
- the output is parsed against a CLOSED schema; an unknown key, a tool, a
locality or privacy field is a violation, reported by path and code only;
- the call makes no tool request (rule:fast-path-no-tools): "escalation" is a
plain validated enum the processor reads, never a request the model makes
(rule:structured-field-decisions).
The stage lists only the permitted-remote profile: there is no device
implementation, so a device-only session refuses it with stage_unlisted
(rule:unlisted-stage-refused).
