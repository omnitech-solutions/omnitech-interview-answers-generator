# @omnitech/logging

One logger for every service in this repository. A line is an event name plus
fields; levels, format and whether content may be written come from the
environment, so the same code runs quiet in production and verbose in a trace.

```ts
import { createLogger } from "@omnitech/logging";
const log = createLogger({ service: "interview-web" });
log.info("companion.heartbeat_stop", { sessionId, sourceId, state: "sourceLost" });
log.trace("ai.execute", { profileId, content: { prompt } }); // content only with LOG_CONTENT=true
```

| Variable | Values | Default |
|---|---|---|
| `LOG_LEVEL` | `error` `warn` `info` `debug` `trace` | `info` in production, `warn` in test, `debug` otherwise |
| `LOG_FORMAT` | `json` `pretty` | `json` in production, `pretty` otherwise |
| `LOG_CONTENT` | `true` to write the `content` field of an event | off; honoured only at level `trace` |

Redaction is not optional: keys that look like credentials are replaced, long
strings are cut, and the `content` field (prompts, model output, transcripts)
is dropped unless `LOG_CONTENT=true` and the level is `trace`.
