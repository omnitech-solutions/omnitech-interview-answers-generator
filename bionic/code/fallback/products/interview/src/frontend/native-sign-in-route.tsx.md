# products/interview/src/frontend/native-sign-in-route.tsx

_Source: `products/interview/src/frontend/native-sign-in-route.tsx` (header-comment fallback)_

The public page the native shell loads while no Studio session exists: the
compact window's own sign-in screen. The tenant routes refuse a signed-out
visitor (they redirect to /sign-in, which the shell never shows in its
privileged web view), so this page is what the window can show instead.

[SAFETY] Public and read-only: it reads no tenant and no member, makes no
write, and carries no content. It draws the sign-in screen only; signing in is
the shell's browser round trip, or the local profile's own Auth.js sign-in,
both of which Studio's server decides.
