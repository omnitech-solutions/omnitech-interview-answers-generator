// Which handler takes a message: a table keyed on the kind the envelope names.
// A new content-free kind is a new row. Anything the table does not name (an
// observation kind, an unknown kind, no kind at all) is an observation, whose
// own validation answers it.
import type { IngestHandler } from "../contracts/ingest";
import { handleCapabilityReport } from "./capability.handler";
import { handleCaptureFailure } from "./capture-failure.handler";
import { handleHeartbeat } from "./heartbeat.handler";
import { handleObservation } from "./observation.handler";
import { handleVoiceActivity } from "./voice-activity.handler";

const CONTENT_FREE_HANDLERS: ReadonlyMap<unknown, IngestHandler> = new Map<
  unknown,
  IngestHandler
>([
  ["heartbeat", handleHeartbeat],
  ["capability.report", handleCapabilityReport],
  ["capture.failure", handleCaptureFailure],
  ["voice.activity", handleVoiceActivity],
]);

export const handlerFor = (kind: unknown): IngestHandler =>
  CONTENT_FREE_HANDLERS.get(kind) ?? handleObservation;
