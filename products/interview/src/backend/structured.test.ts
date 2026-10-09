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
  it("makes one call carrying the request and the reply's JSON Schema, and returns a matching reply", async () => {
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
    const [input, calledScope] = generate.mock.calls[0]! as unknown as [
      { system: string; prompt: string; schema: Record<string, unknown> },
      typeof scope,
    ];
    expect(calledScope).toBe(scope);
    // The instructions and the prompt travel as written: the shape is the
    // engine's to state, in the provider's own structured format.
    expect(input.system).toBe("Write a brief.");
    expect(input.prompt).toBe("Topic: caching");
    expect(input.schema).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        points: { type: "array", items: { type: "string" } },
      },
      required: ["title", "points"],
      additionalProperties: false,
    });
    // An agent runtime's schema check cannot resolve zod's draft reference.
    expect(input.schema).not.toHaveProperty("$schema");
  });

  it("returns the value as the product's own contract reads it", async () => {
    const withDefault = z.object({
      title: z.string().trim(),
      tags: z.array(z.string()).default([]),
    });
    await expect(
      generateChecked(
        async () => ({ title: "  Caching " }),
        request,
        withDefault,
        scope,
      ),
    ).resolves.toEqual({ title: "Caching", tags: [] });
  });

  it("fails once, with the field paths only, when the value misses the product's contract", async () => {
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
      /^The model's reply did not match the required format: title: .*; points: /,
    );
    expect(failure.hint).not.toContain("model text");
    // No correction turn of the product's own: the engine repairs once.
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("reports a failed call as generation-failed, without its error", async () => {
    const generate = vi.fn(async () => {
      throw new Error("ECONNREFUSED secret-host:1234");
    });
    const failure = await generateChecked(
      generate,
      request,
      schema,
      scope,
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(WorkspaceError);
    expect(failure.code).toBe("generation-failed");
    expect(failure.hint).toBe(
      "The model could not be reached, did not reply in time, or did not reply in the required format.",
    );
    expect(failure.hint).not.toContain("secret-host");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
