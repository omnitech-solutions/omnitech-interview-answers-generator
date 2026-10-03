// The Active Session purge. This is the one file that sets app.session_purge
// (rule:purge-delete-setting; scripts/tenant-context-boundary.test.ts). The
// database deletes session observations, actions, the session row and session
// screenshot artifacts (with their payloads) only while the setting is on, the
// owner matches the actor and, for artifacts, the type is the session type.
// U6 fills out the purge itself on top of this wrapper.
import {
  type DatabaseClient,
  enterTenant,
  type PlatformDatabase,
} from "@omnitech/database";

// Runs `work` in an actor-scoped transaction for the session owner with the
// purge setting on. Both the actor scope and the setting are transaction-local.
export function asSessionPurge<Result>(
  database: PlatformDatabase,
  owner: { tenantId: string; ownerUserId: string },
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  return database.transaction(async (client) => {
    await enterTenant(client, {
      tenantId: owner.tenantId,
      actorId: owner.ownerUserId,
    });
    await client.query("SELECT set_config('app.session_purge', 'on', true)");
    return work(client);
  });
}
