# Package boundaries

- `ai-sdk` knows providers and AI transport, never interview semantics.
- `interview-contracts` owns schemas, language routing, and answer workflows.
- `interview-storage` owns persistence interfaces and adapters.
- `code-runner` owns execution isolation.
- `interview-api-client` hides HTTP paths, headers, and response handling.
- `interview-cli` is a thin automation surface over the API client.
- `web` composes packages and owns presentation and HTTP handlers.

Packages expose one root entrypoint. Export public types from that entrypoint and
do not import another package's internal files.
