// What the context pack reads of one application from the database. Each
// function is one tenant transaction in the member's own scope.
import { type PlatformDatabase, withTenant } from "@omnitech/database";
import {
  type BriefScope,
  findCandidacy,
  readBriefMaterial,
  readEmployerBrief,
} from "../../brief/repository";

// [SAFETY] `readBriefMaterial` settles ownership first: another member's
// application, and another workspace's, is `not-found`. The employer brief is
// returned as stored; the caller checks its shape.
export function readApplicationMaterial(
  database: PlatformDatabase,
  scope: BriefScope,
  candidacyId: string,
) {
  return withTenant(
    scope,
    async (db) => ({
      interview: await readBriefMaterial(db, scope, candidacyId),
      brief: await readEmployerBrief(db, scope, candidacyId),
    }),
    { database },
  );
}

// The member's one application to this company for this role, or none.
export function findApplication(
  database: PlatformDatabase,
  scope: BriefScope,
  named: { company: string; role: string },
) {
  return withTenant(
    scope,
    (db) =>
      findCandidacy(db, scope, { company: named.company, role: named.role }),
    { database },
  );
}
