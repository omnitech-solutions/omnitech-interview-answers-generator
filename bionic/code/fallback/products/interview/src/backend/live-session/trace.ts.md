# products/interview/src/backend/live-session/trace.ts

_Source: `products/interview/src/backend/live-session/trace.ts` (header-comment fallback)_

Id-only operational traces of the session processor (rule:id-only-traces).
An event holds ids, revisions, the fence, the profile and locality decision,
durations, an outcome code and byte counts - never a question, transcript,
prompt, draft, credential or a hash of any content. The sink re-checks that
on the way out, so even a careless caller cannot put a free-text value into
a line: every string must be id-shaped or a code, or it is replaced.
