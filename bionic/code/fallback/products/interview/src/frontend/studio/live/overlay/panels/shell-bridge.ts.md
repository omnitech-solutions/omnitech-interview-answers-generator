# products/interview/src/frontend/studio/live/overlay/panels/shell-bridge.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/shell-bridge.ts` (header-comment fallback)_

The few optional things the native shell may offer beyond the negotiated
presentation contract. Each is read defensively from `window.studioHost` and
every one has a page-side fallback, so a shell without it still works:
presentation.nativeToasts === true  the shell draws the toasts itself
studioHost.consent.granted / .open  the shell's one-time consent dialog
localStorage `studio.shell.consented=1`  set by the shell's first-run dialog
