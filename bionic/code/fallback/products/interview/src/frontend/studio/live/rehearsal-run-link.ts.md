# products/interview/src/frontend/studio/live/rehearsal-run-link.ts

_Source: `products/interview/src/frontend/studio/live/rehearsal-run-link.ts` (header-comment fallback)_

How the Rehearsal scorecard picks up the hints of a live session. Setup mints
an opaque rehearsal run id and the session records it (ADR-0012
rule:strict-rehearsal-no-assistance, rule:assistance-counts-as-hints). The
scorecard save sends that id; the SERVER counts the shown drafts, so the
browser never reports a count and the Rehearsal flow stays the only
scorecard writer (rule:no-second-scorecard).
