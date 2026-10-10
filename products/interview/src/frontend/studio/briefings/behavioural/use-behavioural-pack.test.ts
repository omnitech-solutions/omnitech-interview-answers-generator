import type { BriefingArtifact } from "@omnitech/interview-api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useBehaviouralPack } from "./use-behavioural-pack";

const client = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
  getArtifact: vi.fn(),
  editArtifact: vi.fn(),
  ask: vi.fn(),
  prepare: vi.fn(),
  condense: vi.fn(),
  save: vi.fn(),
  importProfile: vi.fn(),
}));
vi.mock("@omnitech/interview-api-client", async (original) => ({
  ...(await original<typeof import("@omnitech/interview-api-client")>()),
  createBriefingClient: () => client,
}));
const callbacks = {
  onCreated: vi.fn(),
  onChanged: vi.fn(),
  onDirtyChange: vi.fn(),
};
function artifact(id: string, revision = 1): BriefingArtifact {
  return {
    provenance: null,
    origin: {
      workspaceId: "briefings",
      artifactId: id,
      artifactRevision: revision,
    },
    updatedAt: "now",
    value: {
      question: "",
      notes: "",
      answer: null,
      briefing: {
        kind: "non-technical-briefing",
        title: id,
        context: {
          company: "Acme",
          role: "Engineer",
          stage: "recruiter",
          profile: { id: "m", revision: 1 },
        },
        expected: ["Why Acme?"],
        questions: [],
      },
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  client.listProfiles.mockResolvedValue({ profiles: [] });
  client.getProfile.mockResolvedValue({
    matrix: { candidate: { name: "Sam" }, roles: [] },
  });
});
it("requires matrix, company, role and questions before creating a pack", async () => {
  const { result } = renderHook(() =>
    useBehaviouralPack({ artifactId: null, ...callbacks }),
  );
  await act(async () => {
    await result.current.actions.start();
  });
  expect(result.current.error).toBe(
    "Choose a matrix and add the company and role first.",
  );
  expect(client.editArtifact).not.toHaveBeenCalled();
  act(() =>
    result.current.actions.changeSetup({
      ...result.current.form.setup,
      profile: { id: "m", revision: 1 },
      company: "Acme",
      role: "Engineer",
    }),
  );
  act(() => result.current.form.setExpected([]));
  await act(async () => {
    await result.current.actions.start();
  });
  expect(result.current.error).toBe("Add at least one question.");
  act(() => result.current.form.setExpected(["Why Acme?"]));
  client.editArtifact.mockResolvedValue(artifact("created"));
  await act(async () => {
    await result.current.actions.start();
  });
  expect(client.editArtifact).toHaveBeenCalledWith(
    expect.stringMatching(/^prep-/),
    expect.objectContaining({ expectedRevision: 0 }),
  );
  expect(callbacks.onCreated).toHaveBeenCalledTimes(1);
});
it("drops a previous pack load and exposes a failed load", async () => {
  let resolve!: (value: BriefingArtifact) => void;
  client.getArtifact
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce(artifact("new"));
  const { result, rerender } = renderHook(
    ({ id }) => useBehaviouralPack({ artifactId: id, ...callbacks }),
    { initialProps: { id: "old" } },
  );
  rerender({ id: "new" });
  await waitFor(() => expect(result.current.data.briefing?.title).toBe("new"));
  await act(async () => resolve(artifact("old")));
  expect(result.current.data.briefing?.title).toBe("new");
  client.getArtifact.mockRejectedValueOnce(new Error("503"));
  rerender({ id: "missing" });
  await waitFor(() =>
    expect(result.current.error).toBe("This pack couldn’t be loaded."),
  );
});
it("serialises revision writes and saves the newest confirmed revision", async () => {
  client.getArtifact.mockResolvedValue(artifact("pack", 1));
  let current = 1;
  client.editArtifact.mockImplementation(async (_id, input) => {
    expect(input.expectedRevision).toBe(current);
    return {
      ...artifact("pack", ++current),
      value: { ...artifact("pack").value, briefing: input.briefing },
    };
  });
  client.save.mockResolvedValue({ draftRevision: 3 });
  const { result } = renderHook(() =>
    useBehaviouralPack({ artifactId: "pack", ...callbacks }),
  );
  await waitFor(() => expect(result.current.data.packRevision).toBe(1));
  await act(async () => {
    await Promise.all([
      result.current.actions.acceptAll(),
      result.current.actions.acceptAll(),
    ]);
  });
  expect(result.current.data.packRevision).toBe(3);
  await act(async () => {
    await result.current.actions.save();
  });
  expect(client.save).toHaveBeenCalledWith(
    "pack",
    expect.objectContaining({ expectedRevision: 3 }),
  );
});

it("does not replace a newly selected pack with an old in-flight write", async () => {
  client.getArtifact.mockImplementation(async (id: string) => artifact(id));
  let resolve!: (value: BriefingArtifact) => void;
  client.editArtifact.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result, rerender } = renderHook(
    ({ id }) => useBehaviouralPack({ artifactId: id, ...callbacks }),
    { initialProps: { id: "old" } },
  );
  await waitFor(() => expect(result.current.data.briefing?.title).toBe("old"));
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.actions.acceptAll();
  });
  await waitFor(() => expect(client.editArtifact).toHaveBeenCalledTimes(1));
  rerender({ id: "new" });
  await waitFor(() => expect(result.current.data.briefing?.title).toBe("new"));
  await act(async () => {
    resolve(artifact("old", 2));
    await pending;
  });
  expect(result.current.data.briefing?.title).toBe("new");
  expect(result.current.data.packRevision).toBe(1);
});
