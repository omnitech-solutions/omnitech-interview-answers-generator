import { describe, expect, it } from "vitest";
import { createClaudeRuntimeAdapter } from "./index.js";

describe("Claude agent runtime", () => {
  it("exposes resumable agent capabilities", () => {
    const runtime = createClaudeRuntimeAdapter();
    expect(runtime.runtime).toBe("claude-code");
    expect(runtime.capabilities).toEqual({
      resume: true,
      structuredOutput: true,
      attachments: true,
      tools: true,
    });
  });
});
