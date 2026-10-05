import { describe, expect, it } from "vitest";
import { createCodexRuntimeAdapter } from "./index";

describe("Codex agent runtime", () => {
  it("exposes resumable agent capabilities", () => {
    const runtime = createCodexRuntimeAdapter({ apiKey: "test-key" });
    expect(runtime.runtime).toBe("codex");
    expect(runtime.capabilities).toEqual({
      resume: true,
      structuredOutput: true,
      attachments: true,
      tools: true,
      imageInput: true,
      toolless: true,
    });
  });
});
