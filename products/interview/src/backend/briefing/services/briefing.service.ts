import type { BriefingProfileImport } from "@omnitech/interview-contracts";
import type {
  WorkspaceDatabasePort,
  WorkspaceScope,
  WorkspaceTransaction,
} from "../../assistant/workspace";
import type { ProposalRecord } from "../contracts";
import * as profiles from "./profiles.service";
import * as proposals from "./proposals.service";

// Preserve the existing entrypoint for callers outside this refactor's ownership.
// Use cases are plain functions; this existing adapter only forwards arguments.
export class BriefingRepository {
  constructor(private readonly database: WorkspaceDatabasePort) {}
  importProfile(scope: WorkspaceScope, input: BriefingProfileImport) {
    return profiles.importProfile(this.database, scope, input);
  }
  syncDefaultProfile(
    scope: WorkspaceScope,
    input: { name: string; matrix: unknown },
  ) {
    return profiles.syncDefaultProfile(this.database, scope, input);
  }
  listProfiles(scope: WorkspaceScope) {
    return profiles.listProfiles(this.database, scope);
  }
  getProfileRevision(scope: WorkspaceScope, id: string, revision: number) {
    return profiles.getProfileRevision(this.database, scope, id, revision);
  }
  getProfileRevisionTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    id: string,
    revision: number,
    lock = false,
  ) {
    return profiles.getProfileRevisionTransaction(
      tx,
      scope,
      id,
      revision,
      lock,
    );
  }
  requireCurrentProfile(scope: WorkspaceScope, id: string, revision: number) {
    return profiles.requireCurrentProfile(this.database, scope, id, revision);
  }
  createProposal(scope: WorkspaceScope, input: Omit<ProposalRecord, "id">) {
    return proposals.createProposal(this.database, scope, input);
  }
  getProposal(scope: WorkspaceScope, id: string) {
    return proposals.getProposal(this.database, scope, id);
  }
  getProposalTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    id: string,
  ) {
    return proposals.getProposalTransaction(tx, scope, id);
  }
  listArtifacts(scope: WorkspaceScope) {
    return proposals.listArtifacts(this.database, scope);
  }
}
