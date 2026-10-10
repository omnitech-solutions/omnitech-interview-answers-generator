import { behaviourFlags } from "../../behaviour-flags";
import { coachPlan } from "../../coach-plan";
import { coachWriters } from "../../coach-writer";
import { coachWriterOptions } from "../domain/conversation";

export function claimWriter(
  id: string,
  asked: { takeover?: unknown; leaseSeconds?: unknown },
) {
  return coachWriters.claim(id, coachWriterOptions(asked));
}

export function releaseWriter(id: string) {
  coachWriters.release(id);
}

export function readPlan() {
  return coachPlan.get();
}

export function savePlan(text: string) {
  return coachPlan.set(text);
}

export function listFlags() {
  return behaviourFlags.list();
}

export function changeFlag(key: string, value: string) {
  const outcome = behaviourFlags.set(key, value);
  if (outcome !== "stored") return { kind: outcome };
  return { kind: "stored" as const, flags: behaviourFlags.list() };
}
