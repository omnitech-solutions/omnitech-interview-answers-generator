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
