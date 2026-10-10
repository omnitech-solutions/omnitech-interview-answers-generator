# apps/agent-worker/src/flagged-loop.ts

_Source: `apps/agent-worker/src/flagged-loop.ts` (header-comment fallback)_

A worker loop that follows the behaviour flags (BEHAVIOUR_FLAGS in the
interview contracts): the loop is built from the environment its flags
resolve to (the host's variable, else what Settings stored, else the
default), and built again when a stored flag changes, so a change in
Settings needs no restart of the worker.

The worker learns what Settings stored the way its coach already reaches the
Studio: the Studio's API, with the API token. Nothing new is opened.

[SAFETY] A log line here names a flag's source of change only by the flags'
own closed values; nothing read from the Studio is content.
