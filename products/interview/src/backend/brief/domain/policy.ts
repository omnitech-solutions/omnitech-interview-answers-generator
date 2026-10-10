import { INTERVIEW_BRIEF_BOUNDS } from "@omnitech/interview-contracts";

// The interview brief's rules that need no database: what a request may do,
// decided from rows the repository already read.
const BOUNDS = INTERVIEW_BRIEF_BOUNDS;

// [GUARD] A new order names exactly the application's stages, each once.
export function isCompleteOrder(
  order: readonly string[],
  stageIds: readonly string[],
): boolean {
  const known = new Set(stageIds);
  return (
    order.length === stageIds.length &&
    new Set(order).size === order.length &&
    !order.some((id) => !known.has(id))
  );
}

// Where stages are parked while they are re-placed: past every ordinal held
// and every ordinal about to be given, so no two ever share one.
export const parkingOrdinal = (ordinals: readonly number[], count: number) =>
  Math.max(0, ...ordinals) + count;

// [DOMAIN] The carry-over of the application's old notes: they go after what
// the first stage already holds. Nothing to carry without notes or a stage;
// refused when the stage's notes would pass their bound.
export function carriedNotes(
  applicationNotes: string | null,
  firstStageNotes: string | null | undefined,
  hasFirstStage: boolean,
): { refused: "nothing-to-carry" | "limit-reached" } | { moved: string } {
  if (!applicationNotes || !hasFirstStage)
    return { refused: "nothing-to-carry" };
  const moved = firstStageNotes
    ? `${firstStageNotes}\n\n${applicationNotes}`
    : applicationNotes;
  if (moved.length > BOUNDS.notesChars) return { refused: "limit-reached" };
  return { moved };
}

// [SAFETY] The policy a transcript was RECORDED under is a fact about the
// recording: a device-only recording is never made sendable afterwards. What
// the person uploaded or pasted is theirs to decide either way.
export const loosensRecording = (
  current: { origin: string; capturePolicy: string },
  asked: string | undefined,
) =>
  current.origin === "recorded" &&
  current.capturePolicy === "device-only" &&
  asked === "permitted-remote";
