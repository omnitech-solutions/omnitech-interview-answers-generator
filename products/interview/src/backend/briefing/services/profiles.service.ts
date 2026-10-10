import { randomUUID } from "node:crypto";
import {
  type BriefingProfileImport,
  candidateMatrixSchema,
} from "@omnitech/interview-contracts";
import {
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  WorkspaceError,
  type WorkspaceScope,
  type WorkspaceTransaction,
} from "../../assistant/workspace";
import type { BriefingDependencies } from "../contracts";
import {
  currentProfileError,
  matrixHash,
  matrixTooLarge,
  nextProfileRevision,
  profileHashError,
  profileImportError,
  shouldSyncDefaultProfile,
} from "../domain/profiles";
import * as profiles from "../repositories/profiles.repository";

export async function listAvailableProfiles(
  options: BriefingDependencies,
  scope: WorkspaceScope,
) {
  if (options.loadDefaultProfile) {
    try {
      const input = await options.loadDefaultProfile(scope);
      if (input) await syncDefaultProfile(options.database, scope, input);
    } catch {
      throw new WorkspaceError("default-profile-unavailable");
    }
  }
  return listProfiles(options.database, scope);
}

export async function importProfile(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
  input: BriefingProfileImport,
) {
  const matrix = candidateMatrixSchema.parse(input.matrix);
  if (matrixTooLarge(matrix)) throw new WorkspaceError("matrix-too-large");
  const id = input.profileId ?? randomUUID();
  const workspace = new InterviewWorkspaceRepository(database);
  return workspace.transaction(scope, async (tx) => {
    await profiles.lockProfiles(tx, scope);
    const existing = await profiles.findProfileForUpdate(tx, scope, id);
    const error = profileImportError(existing, input.expectedRevision);
    if (error) throw new WorkspaceError(error);
    if (existing) await profiles.updateProfile(tx, scope, id, input.name);
    else await profiles.insertProfile(tx, scope, id, input.name);
    const revision = nextProfileRevision(existing);
    const sha256 = matrixHash(matrix);
    await profiles.insertProfileRevision(tx, scope, {
      id,
      revision,
      name: input.name,
      sha256,
      matrix,
    });
    return { id, name: input.name, revision, sha256 };
  });
}

export async function syncDefaultProfile(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
  input: { name: string; matrix: unknown },
): Promise<void> {
  const matrix = candidateMatrixSchema.parse(input.matrix);
  if (matrixTooLarge(matrix)) throw new WorkspaceError("matrix-too-large");
  const id = "local-experience-matrix";
  const sha256 = matrixHash(matrix);
  const workspace = new InterviewWorkspaceRepository(database);
  await workspace.transaction(scope, async (tx) => {
    await profiles.lockProfiles(tx, scope);
    const existing = await profiles.findProfileForUpdate(tx, scope, id);
    if (!shouldSyncDefaultProfile(existing, false, false)) return;
    if (!existing) {
      const any = await profiles.findAnyProfile(tx, scope);
      if (!shouldSyncDefaultProfile(existing, Boolean(any.length), false))
        return;
      await profiles.insertProfile(tx, scope, id, input.name);
    } else {
      const known = await profiles.findKnownContent(tx, scope, id, sha256);
      if (!shouldSyncDefaultProfile(existing, false, Boolean(known))) return;
      await profiles.advanceProfileRevision(tx, scope, id);
    }
    const revision = nextProfileRevision(existing);
    await profiles.insertProfileRevision(tx, scope, {
      id,
      revision,
      name: input.name,
      sha256,
      matrix,
    });
  });
}

export async function listProfiles(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
) {
  return new InterviewWorkspaceRepository(database).transaction(scope, (tx) =>
    profiles.listProfiles(tx, scope),
  );
}

export async function getProfileRevision(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
  id: string,
  revision: number,
) {
  return new InterviewWorkspaceRepository(database).transaction(scope, (tx) =>
    getProfileRevisionTransaction(tx, scope, id, revision),
  );
}

export async function getProfileRevisionTransaction(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
  revision: number,
  lock = false,
) {
  const profile = await profiles.findProfileRevision(
    tx,
    scope,
    id,
    revision,
    lock,
  );
  if (!profile) throw new WorkspaceError("not-found");
  const error = profileHashError(profile.matrix, profile.sha256);
  if (error) throw new WorkspaceError(error);
  return profile;
}

export async function requireCurrentProfile(
  database: WorkspaceDatabasePort,
  scope: WorkspaceScope,
  id: string,
  revision: number,
) {
  const profile = await getProfileRevision(database, scope, id, revision);
  const [latest] = await listProfiles(database, scope).then((items) =>
    items.filter((item) => item.id === id),
  );
  const error = currentProfileError(latest?.revision, revision);
  if (error) throw new WorkspaceError(error);
  return profile;
}
