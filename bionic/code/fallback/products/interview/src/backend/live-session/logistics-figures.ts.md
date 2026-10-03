# products/interview/src/backend/live-session/logistics-figures.ts

_Source: `products/interview/src/backend/live-session/logistics-figures.ts` (header-comment fallback)_

Logistics outcome allowlist (review S1, round 5). Notice period,
compensation, start date and availability are the candidate's own facts, so
a logistics draft may carry a detected figure, unit or date expression only
when it is a verbatim span of an approved preference quote. Approved spans
are removed first; the remainder is checked against named word classes
(numbers, units, months, weekdays, seasons, relative dates, magnitudes).
This is lexical coverage, not a proof that every possible paraphrase is
caught. Review findings extend the classes and their regression cases.

Pure, no I/O, and no copy of the draft or a quote leaves it.
