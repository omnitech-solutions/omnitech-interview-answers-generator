import { describe, expect, it } from "vitest";
import { composeInstructions } from "./index.js";

describe("composeInstructions", () => {
  it("preserves platform-to-task precedence", () => {
    expect(
      composeInstructions({
        platform: ["platform"],
        worker: ["worker"],
        product: ["product"],
        tenant: ["tenant"],
        workflow: ["workflow"],
        task: "task",
      }),
    ).toBe("platform\n\nworker\n\nproduct\n\ntenant\n\nworkflow\n\ntask");
  });
});
