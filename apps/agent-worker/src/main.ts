import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { createClaudeRuntimeAdapter } from "@omnitech/agent-runtime-claude";
import { createCodexRuntimeAdapter } from "@omnitech/agent-runtime-codex";
import {
  AgentPayloadStore,
  getPlatformDatabase,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import { runAgentWorker } from "./index.js";

// The person's installed Codex CLI (CODEX_PATH, else `codex` on PATH): the
// SDK's bundled binary can lag behind it, and a ChatGPT sign-in then refuses
// current models. Falls back to the bundled binary when none is installed.
function installedCodex(): string | undefined {
  if (process.env["CODEX_PATH"]) return process.env["CODEX_PATH"];
  for (const directory of (process.env["PATH"] ?? "").split(delimiter)) {
    const candidate = join(directory, "codex");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}
const codexPath = installedCodex();

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
      // Interactive turns (the assistant) wait on this; an idle claim is one
      // cheap indexed query.
      pollIntervalMs: Number(process.env["AGENT_WORKER_POLL_MS"] ?? 100),
      repository: new PostgresAgentJobRepository(database),
      loadPrompt: (reference) => payloads.load(reference),
      storeResult: (tenantId, result) =>
        payloads.save(tenantId, JSON.stringify(result)),
      runtimes: {
        codex: createCodexRuntimeAdapter(
          codexPath ? { codexPathOverride: codexPath } : {},
        ),
        "claude-code": createClaudeRuntimeAdapter(),
      },
    },
    controller.signal,
  );
} finally {
  await database.close();
}
