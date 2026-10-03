# packages/code-runner/src/sandbox.test.ts

_Source: `packages/code-runner/src/sandbox.test.ts` (header-comment fallback)_

The sandbox controls of the code runner, verified against the REAL argument
vectors DockerCodeRunner builds (not mocks of its internals): a stand-in for
the docker binary records its argv, and every control a sandbox needs is
asserted on that vector - no network, bounded memory, CPU and processes, a
read-only root, no new privileges, a no-exec tmpfs, only per-run temp-dir
mounts (sources read-only, one writable output directory), no host home,
credential or docker socket, no privilege escalation, and no host
environment forwarded. Loosening any bound fails a test here. When Docker
and a runtime image are present, one real container also proves egress is
refused and a host-home marker is unreadable.
