# AI execution policy

Products request a stable profile or capability through `AiExecutionGateway`.
They never switch on vendor names.

| Boundary | Use it for | Do not use it for |
| --- | --- | --- |
| Direct model | One-shot or streaming text, structured output, classification, rewriting, and image generation | Durable state, approval, or multi-step recovery |
| LangChain | Prompt chains, loaders, splitters, retrieval, vector stores, and adapting LangChain streams | Work that is clearer as one direct provider call |
| LangGraph | Tool-using workflows, checkpoints, pause/resume, approvals, branching, and durable retries | Stateless calls that do not need workflow state |
| Agent runtime | Explicit Codex or Claude jobs that need sessions, filesystem tools, or isolated execution | Routine chat, outlines, or image generation |

LangGraph mutations must be idempotent. Product changes are staged and applied
atomically after validation and approval.

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
