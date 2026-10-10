// What ingest tells its listeners after a message is committed. Each event
// names its session and owner from the row found, never from the message.

// One transcript line a session stored.
export type HeardLine = {
  text: string;
  // The audio source the session registered ("microphone", "application-audio").
  source?: string;
  occurredAt: string;
  // The session it was heard in and its owner, from the row found.
  session: { tenantId: string; actorId: string; sessionId: string };
  // Whether the session's owner allows processing off this device.
  remote: boolean;
};

// One audio source of a live session started or stopped hearing a voice. Told
// only for a session whose owner allows processing off this device.
export type VoiceActivityHeard = {
  // The audio source the session registered ("microphone", "application-audio").
  source: "microphone" | "application-audio";
  speaking: boolean;
  // The session it was heard in and its owner, from the row found.
  session: { tenantId: string; actorId: string; sessionId: string };
};
