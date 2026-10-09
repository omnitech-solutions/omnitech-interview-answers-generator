# products/interview/src/backend/coach/transcript-file.ts

_Source: `products/interview/src/backend/coach/transcript-file.ts` (header-comment fallback)_

A recorded conversation as a file, read for replaying through the coach.

Three shapes are read, told apart by what the lines look like:
- a recorder's blocks:  "00:01:12 --> 00:01:19" then "Speaker 1: text"
(also WebVTT and SRT, whose time lines carry fractions and cue numbers)
- plain labelled lines: "Gosha: text"
- plain text:           one unlabelled speaker
[DOMAIN] Nothing is joined here: a replay wants each fragment at the moment
it was said, because when the coach acts depends on exactly that.
