import { briefingDraftSchema } from "@omnitech/interview-contracts";
import { afterEach, expect, it, vi } from "vitest";
import {
  InterviewWorkspaceRepository,
  interviewDraftSchema,
  type WorkspaceDraftRecord,
  WorkspaceError,
  type WorkspaceTransaction,
} from "../../assistant/workspace";
import type { BriefingDependencies } from "../contracts";
import { matrixHash } from "../domain/profiles";
import { applyProposal, putArtifact, saveArtifact } from "./artifacts.service";

const scope = {
  tenantId: "tenant-a",
  actorId: "alice",
  productId: "omnitech.interview",
};
const matrix = { candidate: { name: "Synthetic Candidate" }, roles: [] };
const briefing = briefingDraftSchema.parse({
  kind: "non-technical-briefing",
  title: "Recruiter",
  context: {
    company: "Acme",
    role: "Engineer",
    stage: "recruiter",
    profile: { id: "profile", revision: 1 },
  },
  questions: [],
});
const record: WorkspaceDraftRecord = {
  origin: {
    workspaceId: "briefings",
    artifactId: "artifact",
    artifactRevision: 2,
  },
  value: interviewDraftSchema.parse({ question: "Recruiter", briefing }),
  updatedAt: "2026-10-10T00:00:00Z",
  provenance: null,
};
// This project does not restore mocks between tests: a prototype spy from one
// test would still be counted in the next.
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const events: string[] = [];
  const tx: WorkspaceTransaction = {
    async query(sql) {
      if (sql.startsWith("SELECT r.id")) {
        events.push(
          sql.endsWith("FOR SHARE OF p")
            ? "profile:share-lock"
            : "profile:read",
        );
        return [
          {
            id: "profile",
            name: "Synthetic",
            revision: 1,
            sha256: matrixHash(matrix),
            matrix,
          },
        ];
      }
      if (sql.startsWith("SELECT * FROM interview.briefing_proposals")) {
        events.push("proposal:read");
        return [
          {
            id: "proposal",
            artifact_id: "artifact",
            base_revision: 2,
            profile_id: "profile",
            profile_revision: 1,
            profile_sha256: matrixHash(matrix),
            value: briefing,
            source_snapshot: [],
          },
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  vi.spyOn(
    InterviewWorkspaceRepository.prototype,
    "transaction",
  ).mockImplementation(async (receivedScope, fn) => {
    expect(receivedScope).toEqual(scope);
    events.push("transaction:begin");
    try {
      const result = await fn(tx, receivedScope);
      events.push("transaction:complete");
      return result;
    } catch (error) {
      events.push("transaction:refused");
      throw error;
    }
  });
  const read = vi
    .spyOn(InterviewWorkspaceRepository.prototype, "readTransaction")
    .mockImplementation(
      async (receivedTx, receivedScope, workspaceId, artifactId, lock) => {
        expect(receivedTx).toBe(tx);
        expect(receivedScope).toEqual(scope);
        expect([workspaceId, artifactId]).toEqual(["briefings", "artifact"]);
        events.push(lock ? "artifact:update-lock" : "artifact:read");
        return record;
      },
    );
  const edit = vi
    .spyOn(InterviewWorkspaceRepository.prototype, "editTransaction")
    .mockImplementation(async (receivedTx) => {
      expect(receivedTx).toBe(tx);
      events.push("artifact:edit");
      return record;
    });
  const save = vi
    .spyOn(InterviewWorkspaceRepository.prototype, "saveTransaction")
    .mockImplementation(async (receivedTx) => {
      expect(receivedTx).toBe(tx);
      events.push("artifact:save");
      return {
        workspaceId: "briefings",
        artifactId: "artifact",
        savedRevision: 1,
        draftRevision: 2,
        value: record.value,
        createdAt: record.updatedAt,
        provenance: null,
      };
    });
  const options: BriefingDependencies = {
    database: {
      tenantTransaction: async () => {
        throw new Error("Unexpected transaction");
      },
    },
    generate: async () => ({}),
  };
  return { events, tx, read, edit, save, options };
}
it("holds the profile share lock through the artifact update in one transaction", async () => {
  const f = fixture();
  expect(
    await putArtifact(f.options, scope, "artifact", {
      expectedRevision: 2,
      briefing,
    }),
  ).toBe(record);
  expect(f.events).toEqual([
    "transaction:begin",
    "profile:share-lock",
    "artifact:update-lock",
    "artifact:edit",
    "transaction:complete",
  ]);
});
it("creates a missing artifact only for expected revision zero", async () => {
  const f = fixture();
  f.read.mockRejectedValue(new WorkspaceError("not-found"));
  const create = vi
    .spyOn(InterviewWorkspaceRepository.prototype, "createTransaction")
    .mockImplementation(async (tx) => {
      expect(tx).toBe(f.tx);
      f.events.push("artifact:create");
      return record;
    });
  await putArtifact(f.options, scope, "artifact", {
    expectedRevision: 0,
    briefing,
  });
  expect(create).toHaveBeenCalledOnce();
  expect(f.edit).not.toHaveBeenCalled();
  await expect(
    putArtifact(f.options, scope, "artifact", {
      expectedRevision: 1,
      briefing,
    }),
  ).rejects.toMatchObject({ code: "not-found" });
  expect(create).toHaveBeenCalledOnce();
});
it("reads the first profile then locks it before re-reading and saving the artifact", async () => {
  const f = fixture();
  await saveArtifact(f.options, scope, "artifact", {
    expectedRevision: 2,
    requestId: "request",
  });
  expect(f.events).toEqual([
    "transaction:begin",
    "artifact:read",
    "profile:share-lock",
    "artifact:update-lock",
    "artifact:save",
    "transaction:complete",
  ]);
  expect(f.save.mock.calls[0]?.slice(1)).toEqual([
    scope,
    record.origin,
    "request",
  ]);
});
it("refuses a profile switch discovered after locking without saving", async () => {
  const f = fixture();
  f.read.mockResolvedValueOnce(record).mockResolvedValueOnce({
    ...record,
    value: {
      ...record.value,
      briefing: {
        ...briefing,
        context: {
          ...briefing.context,
          profile: { id: "other", revision: 1 },
        },
      },
    },
  });
  await expect(
    saveArtifact(f.options, scope, "artifact", {
      expectedRevision: 2,
      requestId: "request",
    }),
  ).rejects.toMatchObject({ code: "revision-conflict" });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.events.at(-1)).toBe("transaction:refused");
});
it("loads the proposal before locking its profile and the artifact for apply", async () => {
  const f = fixture();
  await applyProposal(f.options, scope, "artifact", {
    expectedRevision: 2,
    proposalId: "proposal",
  });
  expect(f.events).toEqual([
    "transaction:begin",
    "proposal:read",
    "profile:share-lock",
    "artifact:update-lock",
    "artifact:edit",
    "transaction:complete",
  ]);
  expect(f.edit.mock.calls[0]?.slice(1)).toEqual([
    scope,
    record.origin,
    { briefing },
  ]);
});
