import { beforeEach, describe, expect, it } from "vitest";
import { assistantModelId, documentTarget } from "./assistant-model";

const targets = [
  { id: "document-fast", label: "Fast" },
  { id: "agent/claude-code", label: "Claude Code" },
  { id: "agent/codex", label: "Codex" },
];

beforeEach(() => localStorage.clear());

describe("assistantModelId", () => {
  it("reads the assistant picker's stored model", () => {
    expect(assistantModelId()).toBeNull();
    localStorage.setItem("omnitech-assistant:model", '"agent/codex"');
    expect(assistantModelId()).toBe("agent/codex");
  });

  it("ignores corrupt or non-string values", () => {
    localStorage.setItem("omnitech-assistant:model", "{not json");
    expect(assistantModelId()).toBeNull();
    localStorage.setItem("omnitech-assistant:model", "42");
    expect(assistantModelId()).toBeNull();
  });
});

describe("documentTarget", () => {
  it("follows the assistant's model when it can write documents", () => {
    expect(documentTarget(targets, "agent/codex")).toEqual({
      target: targets[2],
      skipped: null,
    });
  });

  it("prefers Claude Code when the assistant's model cannot write documents", () => {
    expect(documentTarget(targets, "lm-studio/qwen3-coder-30b")).toEqual({
      target: targets[1],
      skipped: "lm-studio/qwen3-coder-30b",
    });
  });

  it("prefers Claude Code when the assistant has no stored choice", () => {
    expect(documentTarget(targets, null).target).toBe(targets[1]);
  });

  it("falls back to the first target, or none", () => {
    expect(documentTarget([targets[0]!], null).target).toBe(targets[0]);
    expect(documentTarget([], null).target).toBeUndefined();
  });
});
