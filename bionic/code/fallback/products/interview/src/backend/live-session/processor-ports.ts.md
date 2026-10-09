# products/interview/src/backend/live-session/processor-ports.ts

_Source: `products/interview/src/backend/live-session/processor-ports.ts` (header-comment fallback)_

The ports the session processor runs against. Everything the processor needs
from the outside is named here and injected, so a tick is testable with
in-memory fakes and, where the fenced writes matter, with the real
repository over a disposable database (session-ports.ts composes that).
The processor never builds an engine (rule:model-calls-gateway-routed): the
host hands one in, and the processor names profiles, never providers.
