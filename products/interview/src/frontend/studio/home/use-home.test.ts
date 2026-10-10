import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useHome } from "./use-home";

const plan = vi.hoisted(() => ({
  plan: null as unknown,
  error: "",
  reload: vi.fn(),
  saveInterview: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock("./use-plan", () => ({ usePlan: () => plan }));
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
beforeEach(() => {
  vi.clearAllMocks();
  plan.plan = { interview: null, items: [] };
  plan.error = "";
});
it("validates before sending and routes each linked plan kind", async () => {
  const { result } = renderHook(() => useHome({ actions, lists }));
  await act(async () => {
    await result.current.actions.saveInterview();
  });
  expect(plan.saveInterview).not.toHaveBeenCalled();
  expect(result.current.error).not.toBe("");
  act(() =>
    result.current.form.setInterview({
      company: " Acme ",
      role: "Engineer",
      scheduledAt: null,
      durationMinutes: 60,
      format: "",
      topics: [],
    }),
  );
  await act(async () => {
    await result.current.actions.saveInterview();
  });
  expect(plan.saveInterview).toHaveBeenCalledWith(
    expect.objectContaining({ company: "Acme", id: null }),
  );
  const item = {
    id: "i",
    kind: "question" as const,
    ref: "q",
    title: "Solve",
    done: false,
    position: 0,
    status: null,
  };
  act(() => {
    result.current.actions.open(item);
    result.current.actions.open({ ...item, kind: "briefing" });
    result.current.actions.open({ ...item, kind: "rehearsal" });
  });
  expect(actions.openArtifact).toHaveBeenCalledWith("q");
  expect(actions.openBriefing).toHaveBeenCalledWith("q");
  expect(actions.go).toHaveBeenCalledWith("rehearsal");
  await act(async () => {
    await result.current.actions.complete(item);
    await result.current.actions.remove(item);
  });
  expect(plan.updateItem).toHaveBeenCalledWith("i", { done: true });
  expect(plan.removeItem).toHaveBeenCalledWith("i");
});
it("keeps request failures visible with the unsaved draft", async () => {
  plan.error = "503";
  const { result } = renderHook(() => useHome({ actions, lists }));
  act(() => result.current.actions.editInterview());
  expect(result.current.status).toBe("error");
  expect(result.current.error).toBe("503");
  expect(result.current.form.editing).toBe(true);
});
