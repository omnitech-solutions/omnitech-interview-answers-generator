# products/interview/src/frontend/studio/account/sign-out-dialog.tsx

_Source: `products/interview/src/frontend/studio/account/sign-out-dialog.tsx` (header-comment fallback)_

The sign-out confirmation. With a live session it warns, and confirming ends
the session first (so capture stops) and only then signs out; if the
session cannot be ended, nothing is signed out. Focus starts on Cancel, Tab
stays inside, Escape or the scrim cancels.
