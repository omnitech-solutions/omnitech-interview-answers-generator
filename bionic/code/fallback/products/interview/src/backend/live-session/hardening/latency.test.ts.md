# products/interview/src/backend/live-session/hardening/latency.test.ts

_Source: `products/interview/src/backend/live-session/hardening/latency.test.ts` (header-comment fallback)_

Hardening case 9 (PB-0002 slice 3): question-end-to-first-draft latency with
the loop-2 synthetic fixtures replayed by the FIXTURE COMPANION through the
REAL routes into the REAL processor, at 1x and 4x, on one virtual clock.
paced       virtual time from the end of the utterance that triggered a
draft (the question, or the part-two follow-up that revised
it) to the draft: settle window + tick quantisation + the
SIMULATED model latency (a constant, below);
processing  real wall-clock time the processor spent from that
utterance's delivery (companion -> route -> store) to the
dispatch finishing; excludes the simulated model.
What this does NOT measure: the real model's latency. The gateway is a fake
that answers instantly and a constant stands in for the model, so the real
question-to-first-draft latency stays UNOBSERVED here; it would be settled
by one agreed rehearsal against a real provider with the packaged companion.
