# products/interview/src/frontend/studio/live/overlay/panels/conversation-model.test.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/conversation-model.test.ts` (header-comment fallback)_

[DOMAIN] A question waits for its notes three minutes at most, so every
reading has a "now". The scripted calls here are read two and a half
minutes in: inside the wait of anything asked in them. `waitingTurn` is
given that moment; `questionsOf` reads the clock itself, so the clock is
set to it.
