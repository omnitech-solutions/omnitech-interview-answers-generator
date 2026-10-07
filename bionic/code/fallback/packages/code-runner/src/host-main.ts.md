# packages/code-runner/src/host-main.ts

_Source: `packages/code-runner/src/host-main.ts` (header-comment fallback)_

The code runner service for the Docker stack, run on the host (Docker is only
reachable from there). The containerised web app calls it through
RemoteCodeRunner; it runs submitted code in the runner's sandboxed containers.
Bundled and started by scripts/docker-host-services.sh. Not part of the
package's public surface (index.ts does not export it).

[SAFETY] Loopback only, a shared bearer token on every call, a bounded body.
The token and body rules live in createRunnerHandler (tested); this file only
adapts Node's HTTP server to it.
