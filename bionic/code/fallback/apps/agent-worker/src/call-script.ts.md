# apps/agent-worker/src/call-script.ts

_Source: `apps/agent-worker/src/call-script.ts` (header-comment fallback)_

A scripted call: who says what, how long after the last person stopped, and
how fast. A script is the source of a fixture; the transcript the coach is
replayed on is made from it, piece by piece, the way a recogniser hears a
call (a phrase arrives when it ends).

[DOMAIN] The script, not the transcript, is what a simulated recording
would be made from later: each line is one person's utterance with its
start and its end, which is what a voice needs.
