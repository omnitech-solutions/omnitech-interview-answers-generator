---
title: "AI execution boundaries and the on-device profile"
slug: ai-execution-boundaries
type: references
tags: [ai, execution, langchain, langgraph, agents, on-device]
sources: []
last_reviewed: 2026-10-02
---

# AI execution boundaries and the on-device profile

Products request a stable profile or capability through `AiExecutionGateway`
and never switch on vendor names. The decision, including where agent runtimes
may run and what is never logged, is
[[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]. This page
is the working reference for choosing an execution boundary.

## Choosing a boundary

| Boundary | Use it for | Do not use it for |
| --- | --- | --- |
| Direct model | One-shot or streaming text, structured output, classification, rewriting, and image generation | Durable state, approval, or multi-step recovery |
| LangChain | Prompt chains, loaders, splitters, retrieval, vector stores, and adapting LangChain streams | Work that is clearer as one direct provider call |
| LangGraph | Tool-using workflows, checkpoints, pause/resume, approvals, branching, and durable retries | Stateless calls that do not need workflow state |
| Agent runtime | Explicit Codex or Claude jobs that need sessions, filesystem tools, or isolated execution | Routine chat, outlines, or image generation |

LangGraph mutations must be idempotent. Product changes are staged and applied
atomically after validation and approval.

## Package map

- `ai-contracts` — provider-neutral execution, model, image, workflow, and
  event contracts.
- `ai-runtime` — profile resolution, authorization, and adapter delegation.
- `ai-provider-*` — provider SDKs and request translation.
- `agent-runtime-*` — Codex and Claude SDK translation.
- `agent-job-service` — the durable job lifecycle; `agent-worker` — isolated
  execution.

## On-device profile

The `on-device` profile runs the Omnitech WebGPU model in the user's browser.
Its adapter comes from omnitech-assistant
(`@omnitech-assistant/provider-on-device`, vendored with the other assistant
packages). `products/interview/src/frontend/on-device.ts` returns the
profile's model manager, `ModelPort` and catalog entry only when a deployment
sets `NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256`, which pins the model manifest
served at `NEXT_PUBLIC_ON_DEVICE_MODEL_URL` (default `/model/manifest.json`),
and the browser has WebGPU. Nothing downloads until a user action calls
`models.load("chat")`. Callers select it by profile id; it never replaces a
configured server profile, and server-side runs cannot use it.
