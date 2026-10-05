# products/interview/src/frontend/studio/live/overlay/session-switcher.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/session-switcher.tsx` (header-comment fallback)_

The session switcher: move across the owner's sessions without leaving the
card. It only re-binds the one session store (actions.switchSession): no
second store, no second poll, and nothing is sent to the session left
behind, so a live session keeps running. "New session" goes to the start
page, which only exists while the store holds no open session.
