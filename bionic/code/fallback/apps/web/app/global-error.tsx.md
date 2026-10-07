# apps/web/app/global-error.tsx

_Source: `apps/web/app/global-error.tsx` (header-comment fallback)_

[SAFETY] Replaces the root layout when a render error escapes every other
boundary. The message is fixed: an error's text or digest can quote a prompt,
a note or a credential (AGENTS rule 8), and the digest is only useful with
server logs this app does not write. It imports no stylesheet so it still
renders when the failure was in the app's own CSS or fonts.
