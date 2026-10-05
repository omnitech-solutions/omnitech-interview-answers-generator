// The id-only trace sink: the event keeps ids, fence, profile, locality,
// duration, outcome and byte counts, and the sink replaces anything that is not
// id- or code-shaped, so content cannot ride out in a line.
import { describe, expect, it } from "vitest";
import {
  createLoggerTraceSink,
  type SessionTraceEvent,
  sanitizeTrace,
} from "./trace";

const event: SessionTraceEvent = {
  event: "dispatch.published",
  sessionId: "2c1f5f4e-0000-4000-8000-000000000001",
  tenantId: "2c1f5f4e-0000-4000-8000-000000000002",
  taskId: "task-1",
  revision: 2,
  fence: 3,
  profileId: "interview-session-fast",
  localityDecision: "permitted-remote",
  durationMs: 41,
  outcome: "published",
  byteCounts: { input: 120, output: 80 },
};

describe("trace sink", () => {
  it("writes one JSON line of ids and codes through the provided logger", () => {
    const lines: string[] = [];
    createLoggerTraceSink((line) => lines.push(line)).emit(event);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual(event);
  });

  it("replaces a free-text value smuggled into an id, code or detail", () => {
    const smuggled = sanitizeTrace({
      ...event,
      taskId: "tell me about your salary at Example Corp",
      outcome: "Why did you leave? CANARY",
      detail: {
        reason: "session_paused",
        path: "sections.0.kind:invalid_value",
        note: "Why did you leave? CANARY",
        "bad key!": "x",
        count: 3,
        flag: true,
      },
    });
    const text = JSON.stringify(smuggled);
    expect(text).not.toContain("CANARY");
    expect(text).not.toContain("salary");
    expect(smuggled.taskId).toBe("[redacted]");
    expect(smuggled.outcome).toBe("invalid_code");
    expect(smuggled.detail).toEqual({
      reason: "session_paused",
      path: "sections.0.kind:invalid_value",
      note: "[redacted]",
      count: 3,
      flag: true,
    });
  });

  it("clamps negative or non-finite numbers to zero", () => {
    const clamped = sanitizeTrace({
      ...event,
      durationMs: -5,
      fence: Number.NaN,
      byteCounts: { input: Number.POSITIVE_INFINITY, output: 7.9 },
    });
    expect(clamped).toMatchObject({
      durationMs: 0,
      fence: 0,
      byteCounts: { input: 0, output: 7 },
    });
  });
});
