# apps/web/app/api/native-auth/redeem/route.ts

_Source: `apps/web/app/api/native-auth/redeem/route.ts` (header-comment fallback)_

The shell loads this inside its web view with the handoff code and its attempt
nonce. A valid, unspent code sets Studio's own session cookie there and sends
the person to the overlay; anything else is refused with no detail.
