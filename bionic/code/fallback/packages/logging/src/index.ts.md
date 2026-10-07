# packages/logging/src/index.ts

_Source: `packages/logging/src/index.ts` (header-comment fallback)_

One structured logger for every service: an event name plus fields, written
as one line (JSON in production, readable elsewhere). Levels, format and
whether content may be written come from the environment, so a trace is a
configuration change, never a code change.

Redaction is built in and cannot be turned off: a key that looks like a
credential is replaced, long strings are cut, and the `content` field (a
prompt, a model's output, a transcript) is dropped unless LOG_CONTENT=true
AND the level is trace. That keeps the default silent about content.
