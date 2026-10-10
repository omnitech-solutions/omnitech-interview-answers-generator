// The public entry of the live-session capability: its routes, the ingest use
// case and the listeners a host hands it.
export type { HeardLine, VoiceActivityHeard } from "./contracts/events";
export type {
  IngestDependencies,
  IngestOptions,
  IngestRequestOptions,
  IngestTestSeams,
} from "./contracts/ingest";
export { createSessionRoutes } from "./routes";
export { ingestObservation } from "./services/ingest.service";
export {
  createTranscriptRecordings,
  type TranscriptRecordings,
} from "./transcript-recording";
export { tellCoachWhoSpeaks } from "./voice-activity";
