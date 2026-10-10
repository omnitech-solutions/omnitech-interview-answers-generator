import type { CoachSpace } from "@omnitech/interview-contracts";

export function notesSpace(space: string | undefined): CoachSpace {
  return space === "replay" ? "replay" : "live";
}

export function transcriptCursor(after: string | undefined): number {
  const cursor = Number(after ?? "0");
  return Number.isInteger(cursor) && cursor > 0 ? cursor : 0;
}

export function conversationIsCurrent(
  conversation: string | undefined,
  epoch: string,
): boolean {
  return conversation === undefined || conversation === epoch;
}

export function coachWriterOptions(asked: {
  takeover?: unknown;
  leaseSeconds?: unknown;
}) {
  return {
    takeover: asked.takeover === true,
    ...(typeof asked.leaseSeconds === "number"
      ? { leaseMs: asked.leaseSeconds * 1000 }
      : {}),
  };
}
