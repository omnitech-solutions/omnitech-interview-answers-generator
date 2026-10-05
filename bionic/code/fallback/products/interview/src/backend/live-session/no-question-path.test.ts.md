# products/interview/src/backend/live-session/no-question-path.test.ts

_Source: `products/interview/src/backend/live-session/no-question-path.test.ts` (header-comment fallback)_

D36 on a disposable PostgreSQL (requires Docker, like the other session
suites): a capture whose result is the closed category no-question is stored
as a normal published result, never owes a solution or an escalation, is
flagged noQuestion in the browser feed, and a typed follow-up on it still
makes a real task revision whose own action carries no flag. Only categories,
counts and ids are asserted, never content.
