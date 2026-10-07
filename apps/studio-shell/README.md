# studio-shell (Interview Studio for macOS)

The native shell: a WKWebView host for the Studio pages at `127.0.0.1:3000`,
the hands-free capture engine (microphone, application audio, screen) and the
floating session window. Build and bundle: `swift build -c release &&
scripts/bundle-app.sh` (see the script's header); tests: `swift run
studio-shell-tests`; the whole native gate: `node scripts/verify-native.mjs`
from the repository root.

## Event log

Everything the app does goes through one entry point,
`EventLog.shared.record(origin, name, fields)` (`Sources/StudioShellCore/EventLog.swift`).
The origin says who caused it: `user` (menu items), `page` (commands from a
Studio page), `heartbeat` (what the companion told Studio), `server`
(acknowledgements and control state), `system` (engine and source state).
The capture companion feeds the same log through its one hook
(`CaptureCore.CompanionEvents`). Fields are codes and ids; keys that look like
credentials or content are dropped before a line is written.

| Variable | Values | Default |
|---|---|---|
| `STUDIO_LOG_LEVEL` | `error` `warn` `info` `debug` `trace` | `info` |
| `STUDIO_EVENT_LOG` | `off` `unified` `file` `both` | `both` |
| `STUDIO_EVENT_LOG_PATH` | a JSON-lines file | `~/Library/Logs/Interview Studio/events.jsonl` |
| `STUDIO_EVENT_LOG_MAX_BYTES` | rotate past this size (one `.1` kept) | `5000000` |

Read the unified log with
`log show --last 10m --predicate 'subsystem == "com.omnitech.studio-shell"'`,
or tail the file. The server side of the same story is `LOG_LEVEL` /
`LOG_FORMAT` / `LOG_CONTENT` in the root `.env.example` (`packages/logging`).
