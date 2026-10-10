import type {
  CoachTranscriptLineInput,
  coachActivityInputSchema,
} from "@omnitech/interview-contracts";
import type { z } from "zod";
import { coachTranscript } from "../../coach-transcript";
import { transcriptCursor } from "../domain/conversation";

export function readLedger(epoch: string) {
  return coachTranscript.ledger(epoch);
}

export function keepLedger(epoch: string, ledger: unknown) {
  return coachTranscript.setLedger(epoch, ledger);
}

export function readTranscript(after: string | undefined) {
  return coachTranscript.since(transcriptCursor(after));
}

export function appendTranscript(lines: readonly CoachTranscriptLineInput[]) {
  return coachTranscript.add(lines);
}

export function setActivity(input: z.infer<typeof coachActivityInputSchema>) {
  coachTranscript.setSpeaking(
    input.speaker,
    input.speaking,
    false,
    input.agoMs ?? 0,
  );
}

export function clearTranscript() {
  return coachTranscript.clear();
}
