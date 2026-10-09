import { beforeEach, describe, expect, it } from "vitest";
import { assistantModelId, documentTarget } from "./assistant-model";

// The prefered target is found by its kind (an attribute the platform lists),
// never by an id: these ids carry no provider name on purpose.
const targets = [
  { id: "document-fast", label: "Fast", kind: "model" as const },
  { id: "agent/first", label: "First agent", kind: "agent" as const },
  {
    id: "agent/second",
    label: "Second agent",
    kind: "agent" as const,
  },
];

beforeEach(() => localStorage.clear());

describe("assistantModelId", () => {
  it("reads the assistant picker's stored model", () => {
    expect(assistantModelId()).toBeNull();
    localStorage.setItem("omnitech-assistant:model", '"agent/second"');
    expect(assistantModelId()).toBe("agent/second");
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
    expect(documentTarget(targets, "agent/second")).toEqual({
      target: targets[2],
      skipped: null,
    });
  });

  it("prefers the first agent target when the assistant's model cannot write documents", () => {
    expect(documentTarget(targets, "lm-studio/qwen3-coder-30b")).toEqual({
      target: targets[1],
      skipped: "lm-studio/qwen3-coder-30b",
    });
  });

  it("prefers the first agent target when the assistant has no stored choice", () => {
    expect(documentTarget(targets, null).target).toBe(targets[1]);
  });

  it("falls back to the first target, or none", () => {
    expect(documentTarget([targets[0]!], null).target).toBe(targets[0]);
    expect(documentTarget([], null).target).toBeUndefined();
  });

  it("falls back to the first target when none is an agent, and for targets with no kind", () => {
    const plain = [
      { id: "a", label: "A" },
      { id: "agent/claude-code", label: "B" },
    ];
    expect(documentTarget(plain, null).target).toBe(plain[0]);
  });
});
