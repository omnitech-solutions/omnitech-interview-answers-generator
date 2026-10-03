# products/interview/src/backend/live-session/prompt-injection-fixtures.ts

_Source: `products/interview/src/backend/live-session/prompt-injection-fixtures.ts` (header-comment fallback)_

SYNTHETIC prompt-injection corpus for the Active Session (ADR-0012
rule:captured-input-untrusted). Invented text, no real credentials, names or
contact details: every secret-looking string is an obvious placeholder. Each
item carries a unique marker (INJ-xxx) so a test can prove, by search, that
none of it reaches the policy text, a trace or a request field.

Four kinds of hostile input are covered:
- captured text and screen text (a transcript line, a window label) and
the same inside employer context (job description, employer notes,
research), each trying to grant a tool, change the profile or model,
switch locality or retention, ask for secrets or the system prompt, or
override allowed actions (submit, send, type into the interviewer's tool,
create an agent job, promote to the experience matrix);
- model replies OUTSIDE the closed schema that try to carry a tool,
locality, retention, credential, profile or job field;
- model replies INSIDE the schema whose allowed fields carry such text.
