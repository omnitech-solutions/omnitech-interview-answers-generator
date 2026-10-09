# products/interview/src/backend/live-session/replay-evidence-fixture.ts

_Source: `products/interview/src/backend/live-session/replay-evidence-fixture.ts` (header-comment fallback)_

Test support for the replay-evidence and prompt-injection suites: reading the
labelled blocks of a session prompt, building a verbatim reference to an
entry the prompt really carries, scripting the fake engine from what a
prompt carries, and reading back the facts a hostile input must not change
(the matrix and catalogue tables, the session row's privacy columns).
Synthetic and content-free by construction. Tests, not production code,
import this.
