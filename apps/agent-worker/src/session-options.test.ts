// The Active Session loop's host wiring: the sandboxed test runner exists only
// when the environment asks for it (ACTIVE_SESSION_CODE_RUNNER=docker), a
// device-local declaration means nothing without it, and agent escalation is
// opt-in and offers only typed, bounded profiles.
import type { PlatformDatabase } from "@omnitech/database";
import { describe, expect, it } from "vitest";
import {
  sessionAgentEscalation,
  sessionLoop,
  sessionRunnerOptions,
} from "./main.js";

describe("sessionRunnerOptions", () => {
  it("configures no runner by default", () => {
    expect(sessionRunnerOptions({})).toEqual({});
    expect(
      sessionRunnerOptions({ ACTIVE_SESSION_CODE_RUNNER: "none" }),
    ).toEqual({});
  });

  it("configures the Docker runner on request, not device-local until declared", () => {
    const options = sessionRunnerOptions({
      ACTIVE_SESSION_CODE_RUNNER: "docker",
    });
    expect(typeof options.codeRunner?.runAll).toBe("function");
    expect(typeof options.codeRunner?.checkSyntax).toBe("function");
    expect(options.runnerDeviceLocal).toBeUndefined();
  });

  it("declares the runner device-local only with an exact true", () => {
    expect(
      sessionRunnerOptions({
        ACTIVE_SESSION_CODE_RUNNER: "docker",
        ACTIVE_SESSION_RUNNER_DEVICE_LOCAL: "true",
      }).runnerDeviceLocal,
    ).toBe(true);
    for (const value of ["yes", "1", "TRUE", ""])
      expect(
        sessionRunnerOptions({
          ACTIVE_SESSION_CODE_RUNNER: "docker",
          ACTIVE_SESSION_RUNNER_DEVICE_LOCAL: value,
        }).runnerDeviceLocal,
      ).toBeUndefined();
  });

  it("ignores a device-local declaration when no runner is configured", () => {
    expect(
      sessionRunnerOptions({ ACTIVE_SESSION_RUNNER_DEVICE_LOCAL: "true" }),
    ).toEqual({});
  });
});

describe("sessionAgentEscalation", () => {
  const database = {} as PlatformDatabase;

  it("is off unless switched on and a payload secret exists", () => {
    expect(sessionAgentEscalation({}, database)).toBeUndefined();
    expect(
      sessionAgentEscalation(
        { AGENT_PAYLOAD_SECRET: "s".repeat(40) },
        database,
      ),
    ).toBeUndefined();
    expect(
      sessionAgentEscalation(
        { ACTIVE_SESSION_AGENT_ESCALATION: "on" },
        database,
      ),
    ).toBeUndefined();
  });

  it("offers only a typed, versioned, bounded profile for each validated kind", () => {
    const port = sessionAgentEscalation(
      {
        ACTIVE_SESSION_AGENT_ESCALATION: "on",
        AGENT_PAYLOAD_SECRET: "s".repeat(40),
      },
      database,
    );
    expect(port).toBeDefined();
    for (const kind of ["repository-navigation", "iterative-repair"] as const) {
      const profile = port?.profileFor(kind);
      expect(profile).toMatchObject({
        version: expect.any(Number),
        sandbox: "read-only",
        approvalPolicy: "never",
        additionalDirectories: [],
        webSearch: false,
      });
    }
  });
});

describe("the session loop with the runner configured", () => {
  it("still starts (the runner is constructed lazily and never touches Docker at startup)", () => {
    const env = {
      AI_BASE_URL: "https://models.example.test/v1",
      AI_MODEL: "m",
      AI_API_KEY: "test-key",
      ACTIVE_SESSION_CODE_RUNNER: "docker",
      ACTIVE_SESSION_RUNNER_DEVICE_LOCAL: "true",
    };
    expect(sessionLoop(env, {} as never, () => undefined)?.name).toBe(
      "session",
    );
  });
});
