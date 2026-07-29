import { createClaudeRuntimeAdapter } from "@omnitech/agent-runtime-claude";
import { createCodexRuntimeAdapter } from "@omnitech/agent-runtime-codex";
import {
  AgentPayloadStore,
  getPlatformDatabase,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import { runAgentWorker } from "./index.js";

const payloadSecret =
  process.env["AGENT_PAYLOAD_SECRET"] ??
  process.env["CONNECTED_ACCOUNT_SECRET"];
if (!payloadSecret) {
  throw new Error("AGENT_PAYLOAD_SECRET is required by the agent worker.");
}
const database = getPlatformDatabase();
const payloads = new AgentPayloadStore(database, payloadSecret);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
  await runAgentWorker(
    {
      workerId: process.env["AGENT_WORKER_ID"] ?? crypto.randomUUID(),
      repository: new PostgresAgentJobRepository(database),
      loadPrompt: (reference) => payloads.load(reference),
      runtimes: {
        codex: createCodexRuntimeAdapter(),
        "claude-code": createClaudeRuntimeAdapter(),
      },
    },
    controller.signal,
  );
} finally {
  await database.close();
}
