# apps/capture-companion/src/control.ts

_Source: `apps/capture-companion/src/control.ts` (header-comment fallback)_

Control pull. The companion holds no control credential: Studio's control
state reaches it only as `control.state` on every acknowledgement and
refusal, which the heartbeat loop keeps flowing (rule:pause-only-credential-stop).
