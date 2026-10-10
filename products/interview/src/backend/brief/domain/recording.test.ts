import { describe, expect, it } from "vitest";
import { newestFirst, recordingOf } from "./recording";

const mine = {
  id: "0b0e7a52-7d3c-4c1e-9c57-3f1f6f0f9a11",
  processingPolicy: "device_only",
};
const file = "2026-10-08T14-03-09-120-0b0e7a52.txt";

describe("recordingOf", () => {
  it("reads the moment from the name and the policy from the session", () => {
    expect(recordingOf(file, [mine])).toEqual({
      file,
      startedAt: "2026-10-08T14:03:09.120Z",
      capturePolicy: "device-only",
    });
    expect(
      recordingOf(file, [{ ...mine, processingPolicy: "permitted_remote" }])
        ?.capturePolicy,
    ).toBe("permitted-remote");
  });
  it("is device-only for any policy that is not permitted_remote", () => {
    expect(
      recordingOf(file, [{ ...mine, processingPolicy: "anything" }])
        ?.capturePolicy,
    ).toBe("device-only");
  });
  it("is nothing for a session that is not the member's or a name of another shape", () => {
    expect(recordingOf(file, [])).toBe(null);
    expect(recordingOf(file, [{ ...mine, id: `1${mine.id.slice(1)}` }])).toBe(
      null,
    );
    expect(recordingOf("notes.txt", [mine])).toBe(null);
    expect(recordingOf(file.replace(".txt", ".vtt"), [mine])).toBe(null);
    expect(recordingOf(`../${file}`, [mine])).toBe(null);
  });
  it("takes the first session whose id starts with the file's eight characters", () => {
    const other = {
      id: `${mine.id.slice(0, 8)}-ffff`,
      processingPolicy: "permitted_remote",
    };
    expect(recordingOf(file, [other, mine])?.capturePolicy).toBe(
      "permitted-remote",
    );
  });
});

describe("newestFirst", () => {
  it("orders by name descending without changing its input", () => {
    const names = ["2026-10-01", "2026-10-03", "2026-10-02"];
    expect(newestFirst(names)).toEqual([
      "2026-10-03",
      "2026-10-02",
      "2026-10-01",
    ]);
    expect(names[0]).toBe("2026-10-01");
  });
});
