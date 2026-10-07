# packages/code-runner/src/serve.ts

_Source: `packages/code-runner/src/serve.ts` (header-comment fallback)_

[DOMAIN] The code runner as a small service. Docker is only reachable from the
host, so when the web app runs in a container the host runs this and the web
app calls it through RemoteCodeRunner. It answers exactly the CodeRunner calls.
[SAFETY] It executes submitted code (in the runner's sandboxed containers), so
every call needs the shared bearer token, the body is bounded, and the caller
is expected to be loopback-only (the host script binds 127.0.0.1).
