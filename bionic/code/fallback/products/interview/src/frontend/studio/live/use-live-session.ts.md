# products/interview/src/frontend/studio/live/use-live-session.ts

_Source: `products/interview/src/frontend/studio/live/use-live-session.ts` (header-comment fallback)_

React's window onto the session store. The store lives outside React, so a
view that unmounts neither stops the session nor starts a second poll.
