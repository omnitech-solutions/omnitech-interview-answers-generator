// `pnpm dev` and the local model: Claude Code is the default executor, so no
// LM Studio model is picked (or loaded) unless one is configured.
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error: a plain .mjs launcher helper without types.
import { defaultLocalModelEnvironment } from "./local-model.mjs";

describe("the dev launcher's default model", () => {
  it("picks no local model when the assistant default is an agent (Claude Code)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      await defaultLocalModelEnvironment({
        INTERVIEW_ASSISTANT_DEFAULT_MODEL: "agent/claude-code",
      }),
    ).toEqual({});
    // Unset means the same default.
    expect(await defaultLocalModelEnvironment({})).toEqual({});
    expect(log.mock.calls.flat().join(" ")).toContain(
      "LM Studio is not started or loaded",
    );
    log.mockRestore();
  });

  it("leaves an explicit model setting alone", async () => {
    for (const name of ["LM_STUDIO_MODEL", "AI_MODEL", "OPENAI_MODEL"])
      expect(await defaultLocalModelEnvironment({ [name]: "x" })).toEqual({});
  });
});
