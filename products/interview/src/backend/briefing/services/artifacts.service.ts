import type {
  briefingApplySchema,
  briefingPutSchema,
  briefingSaveSchema,
} from "@omnitech/interview-contracts";
import type { z } from "zod";
import {
  InterviewWorkspaceRepository,
  WorkspaceError,
  type WorkspaceScope,
} from "../../assistant/workspace";
import type { BriefingDependencies } from "../contracts";
import { sourceSnapshotSchema } from "../contracts";
import {
  artifactRevisionError,
  proposalCitationError,
  proposalRevisionError,
  saveRevisionError,
} from "../domain/artifacts";
import { userEditedBriefing } from "../edits";
import {
  getProfileRevision,
  getProfileRevisionTransaction,
} from "./profiles.service";
import { getProposalTransaction } from "./proposals.service";
export async function readArtifact(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const result = await workspace.read(scope, "briefings", artifactId);
  if (!result.value.briefing) throw new WorkspaceError("not-found");
  await getProfileRevision(
    options.database,
    scope,
    result.value.briefing.context.profile.id,
    result.value.briefing.context.profile.revision,
  );
  return result;
}

export async function putArtifact(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
  input: z.infer<typeof briefingPutSchema>,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const origin = {
    workspaceId: "briefings",
    artifactId,
    artifactRevision: input.expectedRevision,
  };
  const result = await workspace.transaction(scope, async (tx) => {
    await getProfileRevisionTransaction(
      tx,
      scope,
      input.briefing.context.profile.id,
      input.briefing.context.profile.revision,
      true,
    );
    let existing: Awaited<ReturnType<typeof workspace.readTransaction>>;
    try {
      existing = await workspace.readTransaction(
        tx,
        scope,
        "briefings",
        artifactId,
        true,
      );
    } catch (error) {
      if (
        error instanceof WorkspaceError &&
        error.code === "not-found" &&
        input.expectedRevision === 0
      )
        return workspace.createTransaction(tx, scope, origin, {
          question: input.briefing.title,
          briefing: userEditedBriefing(input.briefing),
        });
      throw error;
    }
    return workspace.editTransaction(tx, scope, origin, {
      briefing: userEditedBriefing(input.briefing, existing.value.briefing),
    });
  });
  return result;
}

export async function applyProposal(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
  input: z.infer<typeof briefingApplySchema>,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const applied = await workspace.transaction(scope, async (tx) => {
    const proposal = await getProposalTransaction(tx, scope, input.proposalId);
    const revisionError = proposalRevisionError(
      proposal,
      artifactId,
      input.expectedRevision,
    );
    if (revisionError) throw new WorkspaceError(revisionError);
    const profile = await getProfileRevisionTransaction(
      tx,
      scope,
      proposal.profileId,
      proposal.profileRevision,
      true,
    );
    if (profile.sha256 !== proposal.profileSha256)
      throw new WorkspaceError("evidence-hash-conflict");
    const sources = sourceSnapshotSchema.parse(proposal.sourceSnapshot);
    const citationError = proposalCitationError(proposal.briefing, sources);
    if (citationError) throw new WorkspaceError(citationError);
    const current = await workspace.readTransaction(
      tx,
      scope,
      "briefings",
      artifactId,
      true,
    );
    if (
      !current.value.briefing ||
      artifactRevisionError(
        current.origin.artifactRevision,
        input.expectedRevision,
      )
    )
      throw new WorkspaceError("revision-conflict");
    return workspace.editTransaction(tx, scope, current.origin, {
      briefing: proposal.briefing,
    });
  });
  return applied;
}

export async function saveArtifact(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
  input: z.infer<typeof briefingSaveSchema>,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const saved = await workspace.transaction(scope, async (tx) => {
    const first = await workspace.readTransaction(
      tx,
      scope,
      "briefings",
      artifactId,
    );
    if (!first.value.briefing) throw new WorkspaceError("not-found");
    await getProfileRevisionTransaction(
      tx,
      scope,
      first.value.briefing.context.profile.id,
      first.value.briefing.context.profile.revision,
      true,
    );
    const current = await workspace.readTransaction(
      tx,
      scope,
      "briefings",
      artifactId,
      true,
    );
    const error = saveRevisionError(
      current.value.briefing,
      current.origin.artifactRevision,
      input.expectedRevision,
      first.value.briefing,
    );
    if (error) throw new WorkspaceError(error);
    return workspace.saveTransaction(
      tx,
      scope,
      {
        workspaceId: "briefings",
        artifactId,
        artifactRevision: input.expectedRevision,
      },
      input.requestId,
    );
  });
  return saved;
}
