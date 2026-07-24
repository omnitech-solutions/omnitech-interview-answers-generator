import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshStore() {
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "interviewPlaygroundControlStore");
  return (await import("./playground-control")).playgroundControlStore;
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
        panel: "notes",
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
        panel: "notes",
      },
    });
    expect(store.get()).toBe(reset);
  });

  it("reuses the global store across module reloads", async () => {
    const first = await freshStore();
    first.set({ question: "Preserved across a reload" });

    vi.resetModules();
    const reloaded = (await import("./playground-control"))
      .playgroundControlStore;

    expect(reloaded).toBe(first);
    expect(reloaded.get()).toMatchObject({
      revision: 1,
      value: { question: "Preserved across a reload" },
    });
  });
});
