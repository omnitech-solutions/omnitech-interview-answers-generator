# products/interview/src/backend/live-session/prompt-injection.test.ts

_Source: `products/interview/src/backend/live-session/prompt-injection.test.ts` (header-comment fallback)_

Captured text and images cannot grant tools, change privacy policy or request
secrets (ADR-0012 rule:captured-input-untrusted, ADR-0011
rule:fast-path-no-tools, rule:structured-field-decisions). A synthetic corpus
(prompt-injection-fixtures.ts) of hostile transcript lines, window labels,
employer context and model replies is driven through the REAL processor and
assist stage on a disposable PostgreSQL with a scripted fake gateway (no real
model is reached) and these properties are proven:
- the policy text of every request is constant and equals the policy built
with no input at all; hostile text appears only inside the labelled
captured or employer block it arrived in, never in the policy, the
header, the schema or any request field, and screen text never reaches a
prompt;
- a request has no tool field, and its profile and processing policy are
what the session row dictates;
- a model reply outside the closed schema is rejected as a violation by
path and code, nothing is published, no job is created, no profile or
privacy column and no matrix or catalogue row changes;
- a reply inside the schema that carries hostile text publishes only as
inert data: no job, no promotion, no action kind beyond the answer;
- traces never contain corpus text;
- the checks are not vacuous: a stage that interpolates captured text into
the policy (or into the prompt header) fails them.
