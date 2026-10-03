---
name: ai-provider-maintainer
description: Add or change AI model providers behind AiExecutionGateway while keeping provider SDKs inside ai-provider-* packages and model configuration in the web host.
---

# AI provider maintenance

- Products reach models only through `AiExecutionGateway` profiles
  (`@omnitech/ai-contracts`, `@omnitech/ai-runtime`). They never construct a
  provider client, read model environment variables, or branch on provider
  names.
- A provider lives in its own `packages/ai-provider-*` package that implements
  `ModelProviderAdapter` (or `ImageProviderAdapter`) and exports only its
  adapter factory and option types from `src/index.ts`. Transports, retries and
  output parsing stay private modules of that package.
- `packages/ai-provider-openai` owns OpenAI-compatible chat completions: the
  OpenAI client for keyed endpoints, LM Studio's anonymous loopback-only
  transport with bounded retries, safe failure messages and usage
  normalisation.
- Model endpoints are configured once, in
  `apps/web/src/platform/ai-config.ts` (`AI_*` > `OPENAI_*` > `LM_STUDIO_*`,
  `AI_DEFAULT_PROVIDER_ID`, `AI_TIMEOUT_MS`). Adapters and profiles are wired
  in `apps/web/src/platform/ai.ts`.
- Support cancellation, bounded timeouts, typed results, and safe failure
  messages that name the model and failure kind, never provider text.
- Do not log prompts, responses or credentials. Stub `fetch` or use a provider
  test double instead of real model calls in automated tests.
