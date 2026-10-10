// An observation (a final transcript, a screenshot, a disconnect, a capture
// gap): validated, checked against the session's sources and bounds, deduped
// by source and event id, then stored with its acknowledgement. A resend
// returns the ORIGINAL stored acknowledgement (rule:idempotent-observation);
// the same ids with different content is a conflict and never an overwrite.
import { validateObservation } from "@omnitech/active-session-contracts";
import { checkSnapshotRequest, fulfilCaptureRequest } from "../capture-request";
import type {
  IngestHandler,
  IngestOutcome,
  RefusalReason,
} from "../contracts/ingest";
import { decideObservation } from "../core/index";
import {
  type AcceptedScreenshot,
  checkScreenshot,
  heardLineOf,
  ledgerFor,
  reservedSourceRefusal,
  sameObservation,
  storedContentOf,
  unpermittedSourceRefusal,
  validationRefusal,
  volumeRefusal,
} from "../domain/observation";
import { permittedSources, withoutCapture } from "../domain/session-policy";
import { ingestLog } from "../infrastructure/ingest-log";
import { storeScreenshot } from "../repositories/capture.repository";
import {
  countObservations,
  findStoredObservation,
  insertObservation,
} from "../repositories/observation.repository";
import { touchContact } from "../repositories/session.repository";
import { refusal } from "./acknowledgement";

export const handleObservation: IngestHandler = async (context, envelope) => {
  const { tx, scope, session, status, control, closed, cancelJobs, limits } =
    context;
  const sessionId = session.id;
  const refused = (reason: RefusalReason): IngestOutcome => ({
    ack: refusal(reason.code, {
      control,
      ...(reason.issues ? { issues: reason.issues } : {}),
    }),
    cancelJobs,
  });

  // [GUARD] A session that is not capturing accepts nothing, a resend or not.
  if (closed && status !== "active") return refused({ code: closed });

  // The message itself: its shape, then the sources it may name.
  const validated = validateObservation(envelope);
  if (!validated.ok) return refused(validationRefusal(validated.issues));
  const observation = validated.value;
  const badSource =
    reservedSourceRefusal(observation) ??
    unpermittedSourceRefusal(observation, permittedSources(session));
  if (badSource) return refused(badSource);

  // Stored acknowledgement of a resend, and the session's running counts.
  const stored = await findStoredObservation(tx, scope, sessionId, observation);
  // [SAFETY] The same source and event id with DIFFERENT content is a
  // conflict, never a duplicate and never an overwrite: the stored original
  // stays as it is (rule:idempotent-observation). Only an identical resend
  // reaches the dedup below.
  if (stored && !sameObservation(stored, observation, context.payload))
    return refused({ code: "event_conflict" });
  const counts = await countObservations(tx, scope, sessionId);

  // [STRATEGY] The core decides dedup and the per-session sequence.
  const decision = decideObservation(
    ledgerFor(observation, stored, counts.maxSequence),
    {
      observation,
      sessionStatus: status,
      control: withoutCapture(control),
    },
  );
  if (decision.decision === "refused") return refused({ code: decision.code });
  if (decision.decision === "duplicate")
    return { ack: decision.ack, cancelJobs };

  // [SAFETY] Bounds, enforced before anything is written: one over-limit
  // message is refused with a content-free code and NOTHING is stored.
  const overVolume = volumeRefusal(counts, limits);
  if (overVolume) return refused(overVolume);
  let screenshot: AcceptedScreenshot | null = null;
  if (observation.kind === "screen.snapshot") {
    const checked = checkScreenshot(
      observation,
      context.payload,
      counts.screenshots,
      limits,
    );
    if (!checked.ok) return refused(checked.refusal);
    // [SAFETY] A snapshot that names a capture request must match this
    // session's pending, unexpired one NOW, before anything is stored: an
    // expired, replaced, failed, finished or unknown id is refused, not kept as
    // an ordinary snapshot. No requestId: a plain snapshot, unchanged.
    if (observation.content.requestId !== undefined) {
      const standing = await checkSnapshotRequest(
        tx,
        scope,
        sessionId,
        session,
        observation.content.requestId,
      );
      if (standing === "stale")
        return refused({ code: "capture_request_stale" });
      if (standing === "limit") return refused({ code: "limit_reached" });
    }
    screenshot = checked.screenshot;
  }

  // Store: the screenshot as an owner-private artifact bound to the session,
  // then the observation, and the contact stamp.
  const artifactId = screenshot
    ? await storeScreenshot(tx, scope, sessionId, screenshot)
    : null;
  await insertObservation(tx, scope, sessionId, {
    sourceId: observation.sourceId,
    eventId: observation.eventId,
    sequence: decision.seq,
    kind: observation.kind,
    content: storedContentOf(observation),
    ack: decision.ack,
    screenshotArtifactId: artifactId,
  });
  await touchContact(tx, scope, sessionId);
  // One line per stored observation, so the server log shows what arrived:
  // the kind, the source and a size, never the words (rule:id-only-traces).
  ingestLog.info("observation.stored", {
    sessionId,
    kind: observation.kind,
    sourceId: observation.sourceId,
    sequence: decision.seq,
    ...(observation.kind === "transcript.final"
      ? {
          chars: observation.content.text.length,
          speaker: observation.content.source ?? observation.content.speaker,
          // Written only where content logging is on (a local `pnpm dev`).
          content: observation.content.text,
        }
      : {}),
  });

  // [SAFETY] A capture request is fulfilled only by a snapshot naming the exact
  // id of this session's pending, unexpired request, in this same transaction
  // (the capture credential can never analyse on its own). Anything else leaves
  // the snapshot a plain snapshot. A request just fulfilled is no longer live,
  // so the fresh answer omits it; an unfulfilled one stays on the answer.
  const fulfilled =
    observation.kind === "screen.snapshot" &&
    (await fulfilCaptureRequest(
      tx,
      scope,
      sessionId,
      session,
      observation,
      decision.seq,
    ));
  const answer =
    decision.ack.status === "accepted"
      ? {
          ...decision.ack,
          control: fulfilled ? withoutCapture(control) : control,
        }
      : decision.ack;
  // [SAFETY] Only a line this request newly stored is told to a listener.
  const heard =
    observation.kind === "transcript.final" &&
    decision.ack.status === "accepted"
      ? heardLineOf(observation, {
          scope,
          sessionId,
          remote: session.policy === "permitted-remote",
        })
      : undefined;
  return { ack: answer, cancelJobs, ...(heard ? { heard } : {}) };
};
