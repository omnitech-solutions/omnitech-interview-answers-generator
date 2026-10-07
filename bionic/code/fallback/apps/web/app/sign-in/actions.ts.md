# apps/web/app/sign-in/actions.ts

_Source: `apps/web/app/sign-in/actions.ts` (header-comment fallback)_

One form action for every provider button. The provider and the return
target arrive as form fields, so both are validated here, on the server:
only a configured provider (or the local one, where it is offered) and a
same-origin /t/ path are accepted.
