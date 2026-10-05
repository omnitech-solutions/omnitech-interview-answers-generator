# products/interview/src/frontend/studio/live/overlay/auto-backoff.ts

_Source: `products/interview/src/frontend/studio/live/overlay/auto-backoff.ts` (header-comment fallback)_

Auto's back-off after a no-question result (D36). A capture that showed
nothing to answer (the candidate's editor, Studio's own page, an unreadable
screen) must not be repeated for every small change: until the picture
changed SUBSTANTIALLY or a cooldown passed, Auto does not capture again.
Manual capture never goes through this. Pure; the hook runs the timer.
