# apps/web/src/platform/return-target.ts

_Source: `apps/web/src/platform/return-target.ts` (header-comment fallback)_

[DOMAIN] Where someone goes after signing in. The target travels in the
sign-in URL (`/sign-in?next=...`), so it is attacker-controlled input.

[SAFETY] Only a same-origin path under /t/ is ever a target. The checks
run on the raw text AND the decoded text, so neither `//host`, `/\host`,
an encoded backslash or newline, nor a `..` escape out of /t/ survives.
