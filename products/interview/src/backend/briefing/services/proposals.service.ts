import { randomUUID } from "node:crypto";
import { briefingDraftSchema } from "@omnitech/interview-contracts";
import {
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  WorkspaceError,
  type WorkspaceScope,
  type WorkspaceTransaction,
} from "../../assistant/workspace";
import type { ProposalRecord } from "../contracts";
import * as proposals from "../repositories/proposals.repository";

export async function createProposal(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
  input: Omit<ProposalRecord, "id">,
): Promise<ProposalRecord> {
  const id = randomUUID();
  const briefing = briefingDraftSchema.parse(input.briefing);
  await new InterviewWorkspaceRepository(database).transaction(scope, (tx) =>
    proposals.insertProposal(tx, scope, { ...input, briefing, id }),
  );
  return { ...input, briefing, id };
}

export async function getProposal(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
  id: string,
) {
  return new InterviewWorkspaceRepository(database).transaction(scope, (tx) =>
    getProposalTransaction(tx, scope, id),
  );
}

export async function getProposalTransaction(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
) {
  const proposal = await proposals.findProposal(tx, scope, id);
  if (!proposal) throw new WorkspaceError("not-found");
  return proposal;
}

export async function listArtifacts(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
) {
  return new InterviewWorkspaceRepository(database).transaction(scope, (tx) =>
    proposals.listArtifacts(tx, scope),
  );
}
