# apps/web/app/api/native-auth/redeem/route.ts

_Source: `apps/web/app/api/native-auth/redeem/route.ts` (header-comment fallback)_

The shell loads this inside its web view with the handoff code and its attempt
nonce. A valid, unspent code sets Studio's own session cookie there and sends
the person to the overlay; anything else is refused with no detail.
[SAFETY] Whether the session cookie is Secure (and so named `__Secure-...`),
decided the way Auth.js decides it when it reads the cookie back: the
protocol of AUTH_URL when set, else the forwarded protocol, else the
request's own. Behind a TLS-terminating proxy the request URL is http, and a
cookie set as plain there is never found by Auth.js over https (verified by
experiment): the person would be silently signed out.
