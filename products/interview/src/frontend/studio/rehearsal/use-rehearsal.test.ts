import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useRehearsal } from "./use-rehearsal";

const loaders = vi.hoisted(() => ({ concept: vi.fn(), coding: vi.fn() }));
vi.mock("./material", async (original) => ({
  ...(await original<typeof import("./material")>()),
  loadConcept: loaders.concept,
  loadCoding: loaders.coding,
}));
const lists = {
  questions: [],
  briefings: [],
  briefs: [],
  status: "ready" as const,
  refresh: vi.fn(),
};
const client = { list: vi.fn(), save: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  client.list.mockResolvedValue([]);
  loaders.concept.mockImplementation(async (choice) => ({
    choice,
    followUps: [],
  }));
});
it("does not start a coding phase without a question and runs the concept-only format", async () => {
  const { result } = renderHook(() =>
    useRehearsal({ lists, workspaceId: "w", client }),
  );
  await act(async () => {
    await result.current.actions.start();
  });
  expect(loaders.concept).not.toHaveBeenCalled();
  expect(result.current.context.missingCoding).toBe(true);
  act(() =>
    result.current.form.setValues({
      ...result.current.form.values,
      format: "concept",
    }),
  );
  await act(async () => {
    await result.current.actions.start();
  });
  expect(result.current.stage).toBe("live");
  expect(result.current.data.material.coding).toBeNull();
  expect(result.current.data.session?.elapsed).toBe(0);
});
it("drops material loaded after reset and exposes load failures", async () => {
  let resolve!: (value: unknown) => void;
  loaders.concept.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result } = renderHook(() =>
    useRehearsal({ lists, workspaceId: "w", client }),
  );
  act(() =>
    result.current.form.setValues({
      ...result.current.form.values,
      format: "concept",
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.actions.start();
  });
  act(() => result.current.actions.reset());
  await act(async () => {
    resolve({
      choice: { source: "prompt", ref: "old", title: "Old" },
      followUps: [],
    });
    await pending;
  });
  expect(result.current.stage).toBe("setup");
  expect(result.current.data.session).toBeNull();
  loaders.concept.mockRejectedValueOnce(new Error("503"));
  await act(async () => {
    await result.current.actions.start();
  });
  expect(result.current.error).toBe(
    "The questions couldn’t be loaded. Try again.",
  );
});
it("acts on a Playground start once, then ends and saves the scorecard once", async () => {
  const command = {
    id: "test-start-once",
    action: "start" as const,
    strict: true,
  };
  const codingLists = {
    ...lists,
    questions: [
      {
        artifactId: "q",
        title: "Solve",
        kind: "coding" as const,
        language: null,
        updatedAt: "",
      },
    ],
  };
  loaders.coding.mockResolvedValue({
    choice: { source: "question", ref: "q", title: "Solve" },
    statement: "Solve",
    example: null,
    reveals: {},
  });
  client.save.mockImplementation(async (input) => ({
    ...input,
    id: "saved",
    score: 0,
  }));
  const { result, rerender } = renderHook(
    ({ next }) =>
      useRehearsal({
        lists: codingLists,
        workspaceId: "w",
        command: next,
        client,
      }),
    {
      initialProps: {
        next: command as {
          id: string;
          action: "start" | "end";
          strict: boolean;
        },
      },
    },
  );
  await waitFor(() => expect(result.current.stage).toBe("live"));
  expect(result.current.form.values.strict).toBe(true);
  expect(loaders.coding).toHaveBeenCalledTimes(1);
  rerender({ next: { ...command } });
  expect(loaders.coding).toHaveBeenCalledTimes(1);
  rerender({ next: { id: "test-end-once", action: "end", strict: true } });
  expect(result.current.stage).toBe("score");
  await act(async () => {
    await result.current.actions.saveScorecard();
  });
  await act(async () => {
    await result.current.actions.saveScorecard();
  });
  expect(client.save).toHaveBeenCalledTimes(1);
  expect(result.current.data.history[0]?.id).toBe("saved");
});

it("reopens a stored scorecard without saving it again", async () => {
  const record = {
    id: "history",
    format: "concept" as const,
    strict: false,
    followUps: true,
    concept: { source: "prompt" as const, ref: "react-render", title: "React" },
    coding: null,
    checks: [0, 1],
    reveals: [],
    activeSeconds: 400,
    startedAt: "2026-10-10T10:00:00Z",
    endedAt: "2026-10-10T10:06:40Z",
    score: 20,
  };
  client.list.mockResolvedValue([record]);
  const { result } = renderHook(() =>
    useRehearsal({ lists, workspaceId: "w", client }),
  );
  await waitFor(() => expect(result.current.data.history).toHaveLength(1));
  act(() => result.current.actions.openScorecard(record));
  expect(result.current.stage).toBe("score");
  expect(result.current.data.session?.checks).toEqual([0, 1]);
  expect(result.current.data.material.concept?.choice.title).toBe("React");
  expect(result.current.data.saved?.score).toBe(20);
  expect(client.save).not.toHaveBeenCalled();
});
