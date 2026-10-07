import type { LiveObservation } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { answerHeaderMeta, captureEventChips, clockTime } from "./answer-meta";

const at = (hours: number, minutes: number) =>
  new Date(2026, 9, 6, hours, minutes, 30).toISOString();

const shot = (
  sequence: number,
  eventId: string,
  receivedAt: string,
): LiveObservation =>
  ({
    sequence,
    sourceId: "src",
    eventId,
    kind: "screen.snapshot",
    receivedAt,
    content: { occurredAt: receivedAt, sourceSequence: sequence, body: null },
    screenshotArtifactId: null,
  }) as LiveObservation;
const speech = (sequence: number): LiveObservation =>
  ({
    ...shot(sequence, `s${sequence}`, at(9, 0)),
    kind: "transcript",
  }) as never;

describe("clock time", () => {
  it("pads local hours and minutes", () => {
    expect(clockTime(at(9, 5))).toBe("09:05");
    expect(clockTime(at(14, 30))).toBe("14:30");
    expect(clockTime("not a time")).toBe("");
  });
});

describe("capture event chips", () => {
  const observations = [
    shot(1, "a", at(9, 0)),
    speech(2),
    shot(3, "b", at(9, 5)),
    shot(3, "b", at(9, 5)),
  ];

  it("makes one chip per screenshot, oldest first, ignoring speech", () => {
    const chips = captureEventChips({ observations, noQuestion: [] });
    expect(chips.map((chip) => chip.label)).toEqual([
      "S1 captured",
      "S2 captured",
    ]);
    expect(chips.map((chip) => chip.time)).toEqual(["09:00", "09:05"]);
    expect(chips.every((chip) => chip.kind === "captured")).toBe(true);
  });

  it("says no question found on the capture that had none", () => {
    const chips = captureEventChips({
      observations,
      noQuestion: [
        {
          taskId: "t",
          at: at(9, 5),
          snapshot: { sourceId: "src", eventId: "b" },
        },
      ],
    });
    expect(chips[1]).toMatchObject({
      kind: "no-question",
      label: "S2 · no question found",
    });
    expect(chips[0]?.kind).toBe("captured");
  });
});

describe("answer header meta", () => {
  it("is empty before any capture", () => {
    expect(answerHeaderMeta([])).toBeNull();
  });

  it("names the last capture time and whether it found a question", () => {
    const observations = [shot(1, "a", at(14, 5))];
    expect(
      answerHeaderMeta(captureEventChips({ observations, noQuestion: [] })),
    ).toBe("Last capture 14:05");
    expect(
      answerHeaderMeta(
        captureEventChips({
          observations,
          noQuestion: [
            {
              taskId: "t",
              at: at(14, 5),
              snapshot: { sourceId: "src", eventId: "a" },
            },
          ],
        }),
      ),
    ).toBe("Last capture 14:05 · no question found");
  });
});
