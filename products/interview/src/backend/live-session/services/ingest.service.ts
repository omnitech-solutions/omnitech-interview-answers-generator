// Ingest: one credential-authenticated message (an observation, a heartbeat or
// another content-free report) from the capture companion. Identity comes only
// from the credential (rule:identity-from-credential): the credential's hash
// resolves the ONE session, and every later read or write runs in a
// tenant-and-actor transaction for that session's owner. A failed lookup is
// one refusal (rule:credential-strength); membership is re-verified before any
// domain write (rule:ingest-membership-recheck); bounds are enforced before
// anything is written (rule:bounded-ingest); a resend returns the ORIGINAL
// stored acknowledgement (rule:idempotent-observation). No refusal carries
// content: codes, paths and control state only.
import {
  ACTIVE_SESSION_LIMITS,
  type Acknowledgement,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import { failIfSelectionChanged } from "../capture-request";
import type {
  IngestLimits,
  IngestOptions,
  IngestOutcome,
} from "../contracts/ingest";
import { ingestRefusal } from "../core/index";
import { withCredentialLookup } from "../credential-lookup";
import { readEnvelope } from "../domain/observation";
import {
  controlOf,
  credentialIsLive,
  mayIngest,
  messageKindOf,
} from "../domain/session-policy";
import { isUuid } from "../errors";
import { refusal } from "../handlers/acknowledgement";
import { handlerFor } from "../handlers/index";
import { publishIngestEffects } from "../infrastructure/event-publisher";
import { noteDeclaration } from "../repositories/capability.repository";
import {
  findMemberRole,
  findSessionByCredential,
  lockSession,
  revokeCredential,
} from "../repositories/session.repository";
import { inOwnerScope, type OwnerScope } from "../scope";
import { presentedCredentialHash } from "../session-credential";
import { reconcileLocked } from "../status-transition";

export async function ingestObservation(
  database: PlatformDatabase,
  credentialPlaintext: string,
  tenantId: string,
  rawEnvelope: unknown,
  options: IngestOptions = {},
): Promise<Acknowledgement> {
  const limits = { ...ACTIVE_SESSION_LIMITS, ...options.limits };
  // [GUARD] Size and shape first: they disclose nothing about any session.
  const envelope = readEnvelope(rawEnvelope);
  if (!envelope.ok) return refusal(envelope.code);

  // [SAFETY] Authorise. The one lookup: a named select-only policy admits the
  // single live row whose credential hash is presented, in the tenant the
  // route names.
  const credentialHash = await presentedCredentialHash(credentialPlaintext);
  if (credentialHash === null || !isUuid(tenantId))
    return refusal("credential_refused");
  const found = await withCredentialLookup(
    database,
    { tenantId, credentialHash },
    (client) => findSessionByCredential(client, credentialHash),
  );
  if (!found) return refusal("credential_refused");

  // [STRATEGY] From here the owner is the actor, taken from the row found,
  // never from the message. One tenant transaction is the unit of work: the
  // message is handled and everything it writes is committed together.
  const scope: OwnerScope = { tenantId, actorId: found.ownerUserId };
  const outcome = await inOwnerScope(database, scope, (tx) =>
    handleInTransaction(tx, scope, {
      sessionId: found.id,
      credentialHash,
      envelope: envelope.value,
      options,
      limits,
    }),
  );

  // Committed: tell the listeners. The acknowledgement stands whatever they do.
  await publishIngestEffects(database, scope, found.id, outcome, options);
  return outcome.ack;
}

async function handleInTransaction(
  tx: TenantDatabase,
  scope: OwnerScope,
  message: {
    sessionId: string;
    credentialHash: string;
    envelope: unknown;
    options: IngestOptions;
    limits: IngestLimits;
  },
): Promise<IngestOutcome> {
  const { sessionId, credentialHash, envelope, options, limits } = message;

  // [SAFETY] Membership and the permission that starting a session requires
  // are re-verified before any domain write (rule:ingest-membership-recheck).
  // A removed or demoted member's credential is revoked and refused like any
  // other bad credential.
  if (!mayIngest(await findMemberRole(tx, scope))) {
    await revokeCredential(tx, scope, sessionId);
    return { ack: refusal("credential_refused"), cancelJobs: false };
  }

  // The lock serializes this message against control, other ingest, the
  // processor's writes and the purge.
  const locked = await lockSession(tx, scope, sessionId);
  if (!locked) return { ack: refusal("credential_refused"), cancelJobs: false };
  const credentialLive = credentialIsLive(locked, credentialHash);
  // Time may have changed the session's standing; a change cancels its jobs.
  const reconciled = await reconcileLocked(tx, locked, { contact: true });
  const cancelJobs = reconciled.applied !== null;
  const status = reconciled.status;
  // An expired, revoked or replaced credential is the same single refusal.
  if (!credentialLive)
    return { ack: refusal("credential_refused"), cancelJobs };

  // [SAFETY] A declaration is recorded, and the request bound to a selection
  // that is no longer the companion's is failed, before anything is answered.
  const declaration = options.declaration ?? { captureRequests: false };
  let session = locked;
  if (options.declaration) {
    await noteDeclaration(tx, scope, options.declaration);
    session = await failIfSelectionChanged(
      tx,
      scope,
      session,
      options.declaration,
    );
  }

  // Dispatch on the kind the envelope names.
  return handlerFor(messageKindOf(envelope))(
    {
      tx,
      scope,
      session,
      status,
      control: controlOf(session, status, declaration),
      closed: ingestRefusal(status),
      cancelJobs,
      limits,
      declaration,
      payload: options.payload,
      voiceActivity: options.voiceActivity,
      activityGate: options.activityGate,
    },
    envelope,
  );
}
