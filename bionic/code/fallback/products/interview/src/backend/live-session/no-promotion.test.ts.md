# products/interview/src/backend/live-session/no-promotion.test.ts

_Source: `products/interview/src/backend/live-session/no-promotion.test.ts` (header-comment fallback)_

No promotion (ADR-0011 rule:no-promotion, plan #2 D3): generated answers and
transcript statements are never promoted into the experience matrix or the
exercise catalogue. Two checks hold the line:
1. a static scan: no live-session production source writes to the matrix,
the catalogue or the owner's own records, and none imports their writers
(the scan is proven non-vacuous: its pattern matches known writes, and
the files it reads really contain the session's own writes);
2. a database check: after a full coding and answer run, the matrix and
catalogue tables hold exactly the rows they held before.
