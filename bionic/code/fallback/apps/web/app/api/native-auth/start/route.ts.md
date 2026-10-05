# apps/web/app/api/native-auth/start/route.ts

_Source: `apps/web/app/api/native-auth/start/route.ts` (header-comment fallback)_

The shell opens this in a system web-auth session with its own attempt nonce.
It registers the attempt and starts Studio's ordinary Auth.js sign-in; the
provider pages run in that session, never in the shell's web view.
