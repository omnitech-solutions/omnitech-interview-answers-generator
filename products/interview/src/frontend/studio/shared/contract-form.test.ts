// A form's schema is read from a contract: these are the rules of that read.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contractFormSchema, formProperties } from "./contract-form";

const contract = z.strictObject({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["a", "b"]),
  note: z.string().max(5_000).default(""),
  day: z
    .string()
    .regex(/^\d{4}$/)
    .refine((value) => value !== "0000")
    .optional(),
});

describe("contractFormSchema", () => {
  it("is the contract's input side: bounds, choices, and only what must be typed is required", () => {
    const schema = contractFormSchema(contract);
    expect(schema).not.toHaveProperty("$schema");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["name", "kind"]);
    expect(schema.properties).toMatchObject({
      name: { type: "string", minLength: 1, maxLength: 40 },
      kind: { type: "string", enum: ["a", "b"] },
      note: { type: "string", maxLength: 5_000 },
      day: { type: "string" },
    });
  });

  it("keeps the contract's order, or the order asked for", () => {
    expect(
      formProperties(contractFormSchema(contract)).map(([name]) => name),
    ).toEqual(["name", "kind", "note", "day"]);
    const narrowed = contractFormSchema(contract, ["note", "name"]);
    expect(formProperties(narrowed).map(([name]) => name)).toEqual([
      "note",
      "name",
    ]);
    expect(narrowed.required).toEqual(["name"]);
  });

  it("refuses a field the contract does not have", () => {
    expect(() => contractFormSchema(contract, ["name", "nmae"])).toThrow(
      "Not in the contract: nmae",
    );
  });

  it("does not change the contract it reads", () => {
    const before = JSON.stringify(z.toJSONSchema(contract));
    contractFormSchema(contract, ["name"]);
    expect(JSON.stringify(z.toJSONSchema(contract))).toBe(before);
  });
});
