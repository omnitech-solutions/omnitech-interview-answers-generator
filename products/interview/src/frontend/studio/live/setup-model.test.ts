import type { LiveSessionChoicesResponse } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  buildStartRequest,
  defaultMatrix,
  initialForm,
  matrixOptions,
  type SetupForm,
  startErrorMessage,
} from "./setup-model";

const INTERVIEW = "11111111-1111-4111-8111-111111111111";
const CANDIDACY = "22222222-2222-4222-8222-222222222222";

const choices: LiveSessionChoicesResponse = {
  candidacies: [],
  profiles: [
    {
      profileId: "main",
      name: "Main matrix",
      revision: 3,
      createdAt: "2026-10-01T00:00:00.000Z",
      entryCount: 4,
      latest: true,
    },
    {
      profileId: "main",
      name: "Main matrix",
      revision: 2,
      createdAt: "2026-09-01T00:00:00.000Z",
      entryCount: 3,
      latest: false,
    },
  ],
};

const ready = (patch: Partial<SetupForm>): SetupForm => ({
  ...initialForm(),
  consent: true,
  ...patch,
});

describe("matrix options", () => {
  it("lists the latest revision first and defaults to it", () => {
    const options = matrixOptions(choices.profiles);
    expect(options.map((option) => option.label)).toEqual([
      "Main matrix · latest (revision 3, 4 roles)",
      "Main matrix · revision 2 (3 roles)",
    ]);
    expect(defaultMatrix(choices.profiles)).toBe("main@3");
  });
  it("has no default when no matrix exists", () => {
    expect(matrixOptions([])).toEqual([]);
    expect(defaultMatrix([])).toBe("none");
  });
});

describe("start request", () => {
  it("sends exactly the strict start fields for an interview", () => {
    const request = buildStartRequest(
      ready({
        target: {
          kind: "interview",
          candidacyId: CANDIDACY,
          interviewId: INTERVIEW,
        },
        matrix: "main@3",
      }),
      "run-1",
      choices.profiles,
    );
    expect(request).toEqual({
      processingPolicy: "permitted-remote",
      captureSources: ["microphone", "application-audio", "screen"],
      liveAssistance: true,
      retention: "delete-at-end",
      candidacyId: CANDIDACY,
      interviewId: INTERVIEW,
      profile: { id: "main", revision: 3 },
    });
  });
  it("sends the rehearsal run id and strict flag, and no assistance when strict", () => {
    const request = buildStartRequest(
      ready({ target: { kind: "rehearsal" }, strict: true, matrix: "none" }),
      "run-1",
      choices.profiles,
    );
    expect(request).toEqual({
      processingPolicy: "permitted-remote",
      captureSources: ["microphone", "application-audio", "screen"],
      liveAssistance: false,
      retention: "delete-at-end",
      rehearsal: { runId: "run-1", strict: true },
    });
  });
  it("refuses without a target, consent or a source", () => {
    expect(buildStartRequest(initialForm(), "r", [])).toBeNull();
    expect(
      buildStartRequest(
        ready({ target: { kind: "rehearsal" }, sources: [] }),
        "r",
        [],
      ),
    ).toBeNull();
    expect(
      buildStartRequest(
        { ...initialForm(), target: { kind: "rehearsal" } },
        "r",
        [],
      ),
    ).toBeNull();
  });
});

describe("start errors", () => {
  it("names a specific message for each code and shows a fixed code otherwise", () => {
    const codes = [
      "open_session_exists",
      "link_refused",
      "invalid_input",
      "unauthorized",
      "network",
    ] as const;
    const messages = codes.map((code) => startErrorMessage(code));
    expect(new Set(messages).size).toBe(codes.length);
    expect(startErrorMessage("duration_cap_reached")).toContain(
      "duration_cap_reached",
    );
  });
});
