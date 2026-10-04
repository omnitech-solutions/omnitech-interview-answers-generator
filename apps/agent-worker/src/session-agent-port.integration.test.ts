// Real-provider check of the session agent port (ADR-0016). Skipped unless
// ACTIVE_SESSION_AGENT_INTEGRATION=claude-code|codex names a runtime that is
// signed in on this machine. It sends a fixed trivial prompt and asserts only
// the shape of the result, never its content.
import { createClaudeRuntimeAdapter } from "@omnitech/agent-runtime-claude";
import { createCodexRuntimeAdapter } from "@omnitech/agent-runtime-codex";
import type { AiProfile } from "@omnitech/ai-runtime";
import { resolveAgentProfiles } from "@omnitech/ai-runtime/config";
import { describe, expect, it } from "vitest";
import { createSessionAgentPort } from "./session-agent-port.js";

const runtime = process.env["ACTIVE_SESSION_AGENT_INTEGRATION"];

describe.skipIf(runtime !== "claude-code" && runtime !== "codex")(
  "session agent port against a real provider (requires ACTIVE_SESSION_AGENT_INTEGRATION)",
  () => {
    it("answers one tool-less question and leaves no staged files", async () => {
      const agent = resolveAgentProfiles(process.env).get(
        runtime === "codex" ? "assistant-codex" : "assistant-claude-code",
      );
      if (!agent) throw new Error("profile missing");
      const profile: AiProfile = {
        id: "integration",
        label: "integration",
        family: "agent-runtime",
        targetId: agent.runtime,
        taskTypes: ["structured-generation"],
        enabled: true,
      };
      const port = createSessionAgentPort({
        runtimes: {
          codex: createCodexRuntimeAdapter(),
          "claude-code": createClaudeRuntimeAdapter(),
        },
        profiles: new Map([[profile.id, agent]]),
      });
      const execution = await port.execute(
        {
          context: {
            tenantId: "t",
            userId: "u",
            productId: "p",
            permissions: [],
          },
          task: {
            type: "structured-generation",
            prompt: "Reply with the word ok.",
          },
        },
        profile,
      );
      expect(execution.family).toBe("agent-runtime");
      await port.sweep();
    }, 120_000);
  },
);
