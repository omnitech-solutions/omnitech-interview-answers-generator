# products/interview/src/backend/context-pack/eval/call-scenario.ts

_Source: `products/interview/src/backend/context-pack/eval/call-scenario.ts` (header-comment fallback)_

A written interview call, rendered as a recorder would have heard it.

PROBLEM: a held-out benchmark needs a transcript of a long call (80 minutes,
thousands of fragments) whose every question and answer is known, and a
recording of a real one cannot be kept. Writing 5,000 lines of recorder
output by hand is neither reviewable nor repeatable.
STRATEGY: the call is WRITTEN as prose (who asks what, what the candidate
answers), and `renderCall` cuts that prose the way a recorder does: short
fragments, each with its own clock, disfluencies, dropped capitals and
punctuation, mis-heard terms, back-channels from the other speaker and a
label the recorder sometimes loses. Everything random comes from one seeded
generator, so the same scenario always gives the same bytes.
COMPLEXITY: O(words) in time and space.

[DOMAIN] The format is the recorder's: "HH:MM:SS --> HH:MM:SS", then
"Label: text", then a blank line (brief/transcript.ts reads it).
