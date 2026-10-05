# products/interview/src/frontend/studio/live/overlay/overlay-intents.ts

_Source: `products/interview/src/frontend/studio/live/overlay/overlay-intents.ts` (header-comment fallback)_

Navigation intents from the overlay page to the Studio tab, over a
same-origin BroadcastChannel. An intent names a place (the start page, a
finished session's summary, a session draft in the Workspace) and nothing
else: no session control, no content, no credentials. The Studio shell
listens and moves its own route; if no Studio tab answers, the overlay opens
the place in a new tab instead.
