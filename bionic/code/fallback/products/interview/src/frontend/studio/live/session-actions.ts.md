# products/interview/src/frontend/studio/live/session-actions.ts

_Source: `products/interview/src/frontend/studio/live/session-actions.ts` (header-comment fallback)_

The owner's commands over a session store. Each one calls its route, replaces
the session from the server's response (the record is authoritative) and
answers with a result carrying a fixed error code, never a message.
