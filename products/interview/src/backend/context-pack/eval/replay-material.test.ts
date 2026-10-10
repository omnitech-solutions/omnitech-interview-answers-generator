import { createAiEngine } from "@omnitech/ai-engine";
import { describe, expect, it } from "vitest";
import { createCoachContextFrom } from "../../coach/context";
import { fixtureFolder } from "../bench";
import { readReplayMaterial } from "./replay-material";

// The long synthetic call: stage 2 of the Tidewell application, whose own
// transcript (the call itself) and outcome are kept with the application.
const folder = fixtureFolder("tidewell-care");
const paths = {
  matrix: `${folder}matrix.json`,
  brief: `${folder}employer-brief.json`,
  application: `${folder}stages.json`,
  kept: `${folder}kept-pack.json`,
};
const stagesOf = (stage?: number) =>
  readReplayMaterial({ ...paths, ...(stage ? { stage } : {}) }).context.material
    ?.interviewBrief?.stages ?? [];

describe("a recorded call's material, as its coach would have had it", () => {
  it("leaves out the transcript, the outcome and the next steps of the stage being replayed", () => {
    const [first, second] = stagesOf(2);
    // The call is not over while it is coached: nothing of it is material.
    expect(second?.ordinal).toBe(2);
    expect(second?.transcripts).toEqual([]);
    expect(second?.outcome).toBeNull();
    expect(second?.nextSteps).toBeNull();
    // What the person wrote BEFORE the call stays.
    expect(second?.notes).toEqual(expect.any(String));
    // An earlier stage is over: all of it is known.
    expect(first?.transcripts).toHaveLength(1);
    expect(first?.outcome).toEqual(expect.any(String));
  });

  it("reads every stage whole when no stage is named", () => {
    const [, second] = stagesOf();
    expect(second?.transcripts).toHaveLength(1);
    expect(second?.outcome).toEqual(expect.any(String));
  });

  it("gives the coach nothing a model extracted from the call being replayed, though the kept pack holds it", async () => {
    const SESSION = { tenantId: "t", actorId: "a", sessionId: "s" };
    const offered = async (stage?: number) => {
      const { context, kept } = readReplayMaterial({
        ...paths,
        ...(stage ? { stage } : {}),
      });
      const coach = createCoachContextFrom(
        createAiEngine({
          profiles: [],
          providers: {},
          log: { level: "silent" },
        }),
        async () => ({ context, kept }),
        () => 0,
      );
      // The biggest-migration question of the call, as its fixture words it.
      return coach.facts(
        SESSION,
        "what is the biggest migration you have led, and how did you sequence it",
      );
    };
    const own = stagesOf().find((stage) => stage.ordinal === 2);
    const transcript = own?.transcripts[0]?.id ?? "";
    expect(transcript).not.toBe("");
    const fromTheCall = (facts: { pointer: string }[]) =>
      facts.filter(
        (fact) =>
          fact.pointer.includes(`transcript:${transcript}`) ||
          fact.pointer.startsWith(`/stages/${own?.id}/outcome`),
      );
    // The kept pack does hold what a model read from that transcript.
    const { kept } = readReplayMaterial(paths);
    expect(
      kept?.records.some((record) =>
        JSON.stringify(record.source).includes(transcript),
      ),
    ).toBe(true);
    // With the stage named, nothing of the call; the person's record still is.
    const replayed = await offered(2);
    expect(fromTheCall(replayed)).toEqual([]);
    expect(replayed.some((fact) => fact.pointer.startsWith("/roles/"))).toBe(
      true,
    );
  });
});
