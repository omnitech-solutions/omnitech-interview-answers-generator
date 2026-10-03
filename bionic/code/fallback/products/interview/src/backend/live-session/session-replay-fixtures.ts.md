# products/interview/src/backend/live-session/session-replay-fixtures.ts

_Source: `products/interview/src/backend/live-session/session-replay-fixtures.ts` (header-comment fallback)_

Shared SYNTHETIC replay fixtures for the Active Session processor (E-A1).
Everything here is invented and anonymised: speakers are source labels
(never verified identities), there are no real names, employers, contacts or
compensation figures, and session-replay-fixtures.test.ts scans for that.
The recruiter-screen script has the structure of a real call: split and
timestamped utterances, backchannels interleaved with a monologue, filler, a
compound question, a "part two" follow-up, a deferred topic and an ASR
correction that supersedes an earlier segment.
