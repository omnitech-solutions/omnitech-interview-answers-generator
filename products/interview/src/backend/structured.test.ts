import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { WorkspaceError } from "./assistant/workspace";
import { generateChecked } from "./structured";

const scope = { tenantId: "t", actorId: "a", productId: "p" };
const schema = z.strictObject({
  title: z.string(),
  points: z.array(z.string()).length(3),
});
const request = { system: "Write a brief.", prompt: "Topic: caching" };

describe("generateChecked", () => {
  it("states the shape in the instructions and returns a matching reply", async () => {
    const generate = vi.fn(async () => ({
      title: "Caching",
      points: ["a", "b", "c"],
    }));
    await expect(
      generateChecked(generate, request, schema, scope),
    ).resolves.toEqual({
      title: "Caching",
      points: ["a", "b", "c"],
    });
    expect(generate).toHaveBeenCalledTimes(1);
    const [input] = generate.mock.calls[0]! as unknown as [
      { system: string; prompt: string },
    ];
    expect(input.system).toContain("Write a brief.");
    expect(input.system).toContain('"points"');
    expect(input.prompt).toBe("Topic: caching");
  });

  it("gives one correction turn listing what failed", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ title: "Caching", points: ["a"] })
      .mockResolvedValueOnce({ title: "Caching", points: ["a", "b", "c"] });
    await expect(
      generateChecked(generate, request, schema, scope),
    ).resolves.toMatchObject({
      title: "Caching",
    });
    const correction = generate.mock.calls[1]![0].prompt as string;
    expect(correction).toContain('{"title":"Caching","points":["a"]}');
    expect(correction).toMatch(/- points: /);
  });

  it("fails with the field paths only when the correction still misses", async () => {
    const generate = vi.fn(async () => ({ title: 1, secret: "model text" }));
    const failure = await generateChecked(
      generate,
      request,
      schema,
      scope,
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(WorkspaceError);
    expect(failure.code).toBe("generation-failed");
    expect(failure.hint).toMatch(
      /even after one correction: title: .*; points: /,
    );
    expect(failure.hint).not.toContain("model text");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("reports an unreachable model without its error", async () => {
    const generate = vi.fn(async () => {
      throw new Error("ECONNREFUSED secret-host:1234");
    });
    const failure = await generateChecked(
      generate,
      request,
      schema,
      scope,
    ).catch((error) => error);
    expect(failure.hint).toBe(
      "The model could not be reached or did not reply in time.",
    );
  });
});
