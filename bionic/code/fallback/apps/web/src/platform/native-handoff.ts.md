# apps/web/src/platform/native-handoff.ts

_Source: `apps/web/src/platform/native-handoff.ts` (header-comment fallback)_

[DOMAIN] The native shell's sign-in handoff (ADR-0019 amendment, ADR-0006).
The shell runs Studio's ordinary Auth.js sign-in in a system web-auth
session, then needs the same person signed in inside its embedded web view.
A handoff code carries that one fact across: "this attempt signed in as this
person". It is a login artifact only: it is not a provider token, it is never
derived from or exchanged for one, and it never touches connected accounts.
[SAFETY] Short-lived, single-use, bound to the shell's pending attempt and to
Studio's origin, and held only as a SHA-256 hash. Held in process memory: a
restart drops pending handoffs (the person signs in again); a multi-instance
deployment must back this with a shared store.
