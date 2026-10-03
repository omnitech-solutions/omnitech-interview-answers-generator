# products/interview/src/backend/live-session/assist-stage.ts

_Source: `products/interview/src/backend/live-session/assist-stage.ts` (header-comment fallback)_

The assist stage: the ONE structured model call a session task makes
(ADR-0011 fast path). One call classifies the question AND answers it: the
closed output carries a category, a short spoken draft, claims with their
source references, and for the categories that need them a STAR outline, a
logistics found/missing split or a coding brief.

Captured input is untrusted (rule:captured-input-untrusted): it travels only
inside a labelled, JSON-encoded data block of the prompt, outside the policy
text, and so do the approved experience, the candidate preferences and the
employer material (employer text is an untrusted observation, never policy).
The model's output is parsed against a CLOSED schema, then every claim is
verified against the pinned context snapshot (claims.ts). A field the schema
does not name - a tool, locality, privacy, retention, credential or profile
field - is a violation, and any violation publishes nothing
(rule:structured-field-decisions). Violations name paths and codes only: a
model-controlled string is never copied.

No tools exist in this call (rule:fast-path-no-tools); the coding path is a
separate stage that uses the coding brief this stage produces.
