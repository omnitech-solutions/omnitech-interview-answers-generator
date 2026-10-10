import type { TranscriptPolicy } from "@omnitech/interview-contracts";

// The Studio's recordings are files named for the moment record was pressed
// and the first eight characters of the session's id. Rules only, no I/O.
const RECORDING =
  /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})-([0-9a-f]{8})\.txt$/;

export type RecordingSession = { id: string; processingPolicy: string };

// [SAFETY] A file is the member's own only when its session is one of theirs
// (the first whose id starts with the file's eight characters); any other
// name, and any other member's session, is no recording. Its capture policy
// is the session's, never a choice.
export function recordingOf(
  file: string,
  sessions: readonly RecordingSession[],
): { file: string; startedAt: string; capturePolicy: TranscriptPolicy } | null {
  const named = RECORDING.exec(file);
  if (!named) return null;
  const session = sessions.find((each) => each.id.startsWith(`${named[6]}`));
  if (!session) return null;
  return {
    file,
    startedAt: `${named[1]}T${named[2]}:${named[3]}:${named[4]}.${named[5]}Z`,
    capturePolicy:
      session.processingPolicy === "permitted_remote"
        ? "permitted-remote"
        : "device-only",
  };
}

// Newest first: the names sort by the moment they carry.
export const newestFirst = (names: readonly string[]) =>
  [...names].sort().reverse();
