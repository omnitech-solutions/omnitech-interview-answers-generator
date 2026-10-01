---
targets: ["*"]
description: AI model, workflow, image, and agent runtime boundaries
---

# AI execution

- Products call `AiExecutionGateway` using stable profiles or capabilities.
  Product code must not branch on provider or model names.
- Stateless language and image APIs implement provider adapters. Codex and
  Claude Code implement `AgentRuntimeAdapter` and run only in the isolated
  agent worker.
- Use direct model execution for one-shot, structured, streaming, and image
  tasks. Use LangChain for loaders, retrieval, prompt chains, and stream
  adaptation. Use LangGraph only for durable, interruptible, tool-using
  workflows.
- Next.js may create, inspect, cancel, and resume jobs. It must never launch an
  agent process.
- Agent profiles are typed, versioned, centrally configured, and bounded.
  Never accept raw CLI arguments, arbitrary environment variables, arbitrary
  directories, arbitrary MCP servers, or permission bypasses from users.
- Do not log prompts, generated content, attachments, credentials, source
  files, or provider-native events by default.
- Persist normalized usage and failure metadata. Keep provider-native objects
  private to their adapter package.
