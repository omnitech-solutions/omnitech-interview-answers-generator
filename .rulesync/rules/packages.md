---
targets: ["*"]
description: Reusable package and SDK boundaries
---

# Package boundaries

- `platform-contracts` owns stable framework-neutral platform and product
  contracts.
- `platform-runtime` owns trusted product registration and route resolution.
- `platform-api` owns platform HTTP contracts without importing Next.js.
- `platform-storage` owns PostgreSQL access, tenant transactions, migrations,
  encryption boundaries, and platform repositories.
- `platform-integrations` owns OAuth protocol behavior without UI or database
  access.
- `products/*` own complete product verticals: manifest, frontend, backend,
  services, and tests.
- `ai-contracts` owns provider-neutral execution, model, image, workflow, and
  event contracts.
- `ai-runtime` owns profile resolution, authorization, and adapter delegation.
- `ai-provider-*` packages own provider SDKs and request translation.
- `ai-workflow-*` packages own LangChain and LangGraph integration.
- `agent-runtime-*` packages own Codex and Claude SDK translation.
- `agent-job-service` owns the durable job lifecycle; `agent-worker` owns
  isolated execution.
- `ai-sdk` remains a compatibility facade for migrated consumers and never
  owns product semantics.
- `interview-contracts` owns schemas, language routing, and answer workflows.
- `interview-storage` owns persistence interfaces and adapters.
- `code-runner` owns execution isolation.
- `interview-api-client` hides HTTP paths, headers, and response handling.
- `interview-cli` is a thin automation surface over the API client.
- `web` is the thin Next.js shell. It composes registered products, mounts API
  routers, resolves auth and tenant context, and owns global presentation.

Packages expose one public entrypoint per intentional runtime surface. Export
public types from those entrypoints and do not import internal files.
