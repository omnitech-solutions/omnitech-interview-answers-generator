import { describe, expect, it } from "vitest";
import { renderEvent } from "./render-event.js";

describe("agent job event rendering", () => {
  it("renders normalized text and failure events without vendor objects", () => {
    expect(renderEvent({ type: "text-delta", text: "hello\nworld" })).toBe(
      "hello\r\nworld",
    );
    expect(
      renderEvent({
        type: "failed",
        error: { message: "Output did not match the schema." },
      }),
    ).toContain("Output did not match the schema.");
  });
});
