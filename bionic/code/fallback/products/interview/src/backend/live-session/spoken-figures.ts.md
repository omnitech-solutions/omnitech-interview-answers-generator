# products/interview/src/backend/live-session/spoken-figures.ts

_Source: `products/interview/src/backend/live-session/spoken-figures.ts` (header-comment fallback)_

Spelled-out quantities as figures (review S1, round 3). A notice period or a
compensation figure may be spoken as words ("three months", "one hundred and
fifty thousand", "a fortnight", "the first of March", "III months"), so the
words are normalised to the same numeric keys the digit pipeline produces and
then get the same treatment as digits in EVERY sentence of a draft.

Pure, no I/O. The caller says whether the sentence is about compensation or
notice period (`topical`): only there does a bare definite number word
("three") count without an adjacent unit.
