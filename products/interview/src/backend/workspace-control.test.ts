import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshStore() {
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "interviewPlaygroundControlStore");
  return (await import("./workspace-control")).playgroundControlStore;
}

describe("playgroundControlStore", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "interviewPlaygroundControlStore");
  });

  it("starts with an empty playground", async () => {
    const store = await freshStore();

    expect(store.get()).toMatchObject({
      revision: 0,
      value: {
        question: "",
        language: "auto",
        answer: null,
        notes: "",
        panel: "terminal",
      },
    });
    expect(Date.parse(store.get().updatedAt)).not.toBeNaN();
  });

  it("merges patches and advances the revision without dropping other fields", async () => {
    const store = await freshStore();

    const first = store.set({
      question: "Build a counter",
      language: "react",
      notes: "Use a functional updater.",
    });
    const second = store.set({ panel: "output" });

    expect(first.revision).toBe(1);
    expect(second).toMatchObject({
      revision: 2,
      value: {
        question: "Build a counter",
        language: "react",
        notes: "Use a functional updater.",
        panel: "output",
      },
    });
  });

  it("reset restores every field and advances the revision", async () => {
    const store = await freshStore();
    store.set({
      question: "Question",
      language: "php",
      answer: {
        title: "Answer",
        language: "php",
        answerMarkdown: "Explanation",
        code: "<?php",
        usageCode: "echo 'usage';",
        testCode: "tests",
      },
      notes: "Notes",
      panel: "saved",
    });

    const reset = store.reset();

    expect(reset).toMatchObject({
      revision: 2,
      value: {
        question: "",
        language: "auto",
        answer: null,
        notes: "",
        panel: "terminal",
      },
    });
    expect(store.get()).toBe(reset);
  });

  it("reuses the global store across module reloads", async () => {
    const first = await freshStore();
    first.set({ question: "Preserved across a reload" });

    vi.resetModules();
    const reloaded = (await import("./workspace-control"))
      .playgroundControlStore;

    expect(reloaded).toBe(first);
    expect(reloaded.get()).toMatchObject({
      revision: 1,
      value: { question: "Preserved across a reload" },
    });
  });

  it("upgrades a legacy global store while preserving its snapshot", async () => {
    const snapshot = {
      revision: 4,
      updatedAt: "2026-07-25T08:00:00.000Z",
      value: {
        question: "",
        language: "auto" as const,
        answer: null,
        notes: "",
        panel: "terminal" as const,
        view: "concept-lab" as const,
        explanation: null,
        explanations: [],
      },
    };
    Reflect.set(globalThis, "interviewPlaygroundControlStore", {
      get: () => snapshot,
      reset: () => snapshot,
      set: () => snapshot,
    });

    vi.resetModules();
    const upgraded = (await import("./workspace-control"))
      .playgroundControlStore;

    expect(upgraded.get()).toBe(snapshot);
    expect(upgraded.appendExplanation).toBeTypeOf("function");
    expect(
      upgraded.appendExplanation({
        title: "Follow-up",
        topic: "Focus",
        markdown: "# Focus",
      }),
    ).toMatchObject({
      revision: 5,
      value: {
        explanation: { title: "Follow-up" },
        explanations: [{ title: "Follow-up" }],
      },
    });
  });
});
