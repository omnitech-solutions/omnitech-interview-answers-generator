# products/interview/src/frontend/studio/live/overlay/panels/use-account.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/use-account.ts` (header-comment fallback)_

The native window's account side: the shell's `account` bridge (sign-in in the
person's default browser, sign-out, the Mac's permissions), Studio's public
list of what can sign in, and the local profile's sign-in done inside this web
view. Every read is defensive: a shell without the bridge, or a Studio that
does not answer, leaves the screens saying so instead of offering a dead button.

[SAFETY] Nothing here holds an address, code, nonce or token: the shell keeps
the sign-in link to itself, and the local sign-in is Studio's own Auth.js form
post with its own CSRF token, same origin, in the page that asked for it.
