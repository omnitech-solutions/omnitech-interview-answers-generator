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
| `LOG_FORMAT` | `json` `pretty` `story` | `json` in production, `pretty` otherwise |
| `LOG_CONTENT` | `true` to write the `content` field of an event | off; honoured at level `trace`, or in the `story` format outside production |

`pnpm dev` sets `LOG_FORMAT=story`, `LOG_CONTENT=true` and `LOG_LEVEL=trace` on this machine.

**Formats.** `json`: one object per line (`time`, `level`, `service`, `event`, then the fields).
`pretty`: `clock LEVEL service event key=value …`, always one line (a line break in a value is
written escaped, an undefined value is left out). `story`: what a person reads while a session
runs: the session's events (`HEARD`, `QUESTION`, `ANSWER`, `NO ANSWER`) and the AI engine's
(`AI`, `AI WARN`, `AI ERROR`, and with content `PROMPT` and `REPLY`) each on a labelled line;
everything else one dim line.

**Redaction is not optional.** A key that looks like a credential is replaced (a count such as
`inputTokens: 1840` is a number and is kept); a string over 2,000 characters is cut; an `Error`
is written as its `name`, `message`, `code` and `source` (the first frame of this application),
never its stack; and the `content` field (prompts, model output, transcripts) is dropped unless
`LOG_CONTENT=true` and a person chose to read it. When content is allowed it is written
**whole**: the cut does not apply inside `content`.

**The AI engine's lines.** The engine has its own logger (`@omnitech/ai-engine`); every engine
the Studio builds is given this package as its sink by `engineLog` in
`@omnitech/platform-runtime/ai-log`, so one format reaches the terminal. An engine event
arrives as `ai.<event>` with the engine's sentence as `message`; the two content events
(`ai.prompt`, `ai.completion`) carry what was said in `content`, so the switch above governs
them like any other content.
