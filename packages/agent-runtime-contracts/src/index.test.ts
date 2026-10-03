import { describe, expect, it } from "vitest";
import { type AgentProfile, validateAgentProfile } from "./index.js";

const safeProfile: AgentProfile = {
  id: "document-quality",
  version: 1,
  runtime: "claude-code",
  model: "configured-model",
  fallbackModels: [],
  effort: "high",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 2,
  timeoutMs: 60_000,
  maximumOutputBytes: 1_000_000,
  additionalDirectories: [],
  webSearch: false,
};

describe("agent profiles", () => {
  it("accepts a bounded read-only profile", () => {
    expect(() => validateAgentProfile(safeProfile)).not.toThrow();
  });

  it("rejects unapproved additional directories", () => {
    expect(() =>
      validateAgentProfile({
        ...safeProfile,
        additionalDirectories: ["/"],
      }),
    ).toThrow("Additional directories");
  });

  it("rejects a profile without a positive integer version", () => {
    expect(() => validateAgentProfile({ ...safeProfile, version: 0 })).toThrow(
      "version",
    );
  });

  it("rejects unattended write access", () => {
    expect(() =>
      validateAgentProfile({
        ...safeProfile,
        sandbox: "workspace-write",
      }),
    ).toThrow("cannot combine");
  });
});
