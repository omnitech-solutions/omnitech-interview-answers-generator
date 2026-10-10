import type { Brief, BriefRequest } from "@omnitech/interview-contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { briefSelectionOf, useBriefings } from "./use-briefings";

const actions = {
  go: vi.fn(),
  openArtifact: vi.fn(),
  openBriefing: vi.fn(),
  openBrief: vi.fn(),
  newQuestion: vi.fn(),
  runTests: vi.fn(),
  toggleTheme: vi.fn(),
  toggleAssistant: vi.fn(),
};
const lists = {
  questions: [],
  briefings: [],
  briefs: [],
  status: "ready" as const,
  refresh: vi.fn(),
};
const client = { list: vi.fn(), get: vi.fn(), build: vi.fn(), remove: vi.fn() };
const brief = (id: string): Brief => ({
  id,
  title: id,
  kind: "concept",
  topic: "React",
  updatedAt: "now",
  brief: {
    version: 1,
    headline: "React",
    points: [
      { heading: "One", body: "One" },
      { heading: "Two", body: "Two" },
      { heading: "Three", body: "Three" },
    ],
    example: "Example",
    pitfall: "Pitfall",
    followUps: [{ question: "Why?", answer: "Because" }],
  },
});
beforeEach(() => vi.clearAllMocks());
it("parses the existing route variants", () => {
  expect(briefSelectionOf([])).toEqual({ kind: "new" });
  expect(briefSelectionOf(["brief", "b"])).toEqual({ kind: "brief", id: "b" });
  expect(briefSelectionOf(["pack", "draft"])).toEqual({
    kind: "pack",
    id: "pack",
    draft: true,
  });
  expect(briefSelectionOf(["explanations"])).toEqual({ kind: "explanations" });
});
it("drops an older brief response when another brief is selected", async () => {
  let resolve!: (value: Brief) => void;
  client.get
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce(brief("new"));
  const { result, rerender } = renderHook(
    ({ rest }) => useBriefings({ rest, actions, lists, client }),
    { initialProps: { rest: ["brief", "old"] } },
  );
  rerender({ rest: ["brief", "new"] });
  await waitFor(() => expect(result.current.data.brief?.id).toBe("new"));
  await act(async () => resolve(brief("old")));
  expect(result.current.data.brief?.id).toBe("new");
});
it("validates builds, prevents duplicate submission, and refreshes after success", async () => {
  let resolve!: (value: Brief) => void;
  client.build.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result } = renderHook(() =>
    useBriefings({ rest: [], actions, lists, client }),
  );
  await act(async () => {
    await result.current.actions.build();
  });
  expect(client.build).not.toHaveBeenCalled();
  act(() =>
    result.current.form.setValues({
      kind: "concept",
      topic: " React ",
    } satisfies BriefRequest),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.actions.build();
    void result.current.actions.build();
  });
  expect(client.build).toHaveBeenCalledTimes(1);
  expect(client.build).toHaveBeenCalledWith({
    kind: "concept",
    topic: "React",
  });
  await act(async () => {
    resolve(brief("built"));
    await pending;
  });
  expect(actions.openBrief).toHaveBeenCalledWith("built");
  expect(lists.refresh).toHaveBeenCalledTimes(1);
});
it("reports load and delete errors and keeps the selected brief", async () => {
  client.get.mockRejectedValueOnce(new Error("503"));
  client.remove.mockRejectedValueOnce(new Error("Delete refused"));
  const { result } = renderHook(() =>
    useBriefings({ rest: ["brief", "b"], actions, lists, client }),
  );
  await waitFor(() =>
    expect(result.current.error).toBe("This brief couldn’t be loaded."),
  );
  await act(async () => {
    await result.current.actions.remove();
  });
  expect(actions.go).not.toHaveBeenCalled();
  expect(result.current.context.selected).toBe("b");
});
