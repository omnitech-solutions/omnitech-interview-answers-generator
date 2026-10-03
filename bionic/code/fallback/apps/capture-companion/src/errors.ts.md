# apps/capture-companion/src/errors.ts

_Source: `apps/capture-companion/src/errors.ts` (header-comment fallback)_

The companion's only thrown error. The message IS the code, so nothing a
caller passed (a credential, transcript text, a URL) can ride along in an
error (rule:credential-storage, rule:id-only-traces).
