# products/interview/src/backend/services.ts

_Source: `products/interview/src/backend/services.ts` (header-comment fallback)_

[DOMAIN] Docker is only reachable from the host. A web app running in a container
names the host's runner service (scripts/docker-host-services.sh) with
CODE_RUNNER_URL and CODE_RUNNER_TOKEN; everywhere else the local Docker runs it.
