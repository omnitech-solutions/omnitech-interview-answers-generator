# products/interview/src/backend/live-session/replay-fixtures-hazards.ts

_Source: `products/interview/src/backend/live-session/replay-fixtures-hazards.ts` (header-comment fallback)_

SYNTHETIC grounding-hazard and transcript-shape fixtures (E-A1). Invented
and anonymised: only the placeholders Interviewer, Candidate and Example
Corp, no real employer, no contact detail, no currency or compensation
amount in any spoken text (a notice-period or compensation QUESTION is fine).

Each set records what the baseline policy (interview-policy.ts
decideBaseline) really produces for its text, as `expect`; the fixture test
re-derives those facts so the description cannot drift from the policy.
Segments alternate speakers so consecutive same-speaker lines never coalesce
two questions into one utterance by accident.
