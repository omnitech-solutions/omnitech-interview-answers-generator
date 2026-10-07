# products/interview/src/frontend/studio/account/sign-out.ts

_Source: `products/interview/src/frontend/studio/account/sign-out.ts` (header-comment fallback)_

Ending this browser's sign-in with Auth.js's own endpoints: a same-origin
CSRF token, then a POST to /api/auth/signout. The session is a stateless
token, so this ends THIS browser's session only; nothing is revoked for
other devices, and the page says so.
