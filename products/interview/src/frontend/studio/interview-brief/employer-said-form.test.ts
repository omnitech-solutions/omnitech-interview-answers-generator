// The "Employer said" entry form's declaration: the contract's fields, an
// optional choice that can be left unsaid, and values that lose nothing.
import {
  EMPLOYER_SAID_CHANNELS,
  employerSaidInputSchema,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  employerSaidFormSchema,
  employerSaidUiSchema,
  emptyEmployerSaid,
  toEmployerSaidInput,
} from "./employer-said-form";

const names = Object.keys(employerSaidFormSchema.properties ?? {});

describe("the employer-said form", () => {
  it("has exactly the contract's fields, in its order, and requires only what was said", () => {
    expect(names).toEqual(Object.keys(employerSaidInputSchema.shape));
    expect(employerSaidFormSchema.required).toEqual(["said"]);
  });

  it("offers every channel of the contract, after 'not said'", () => {
    const channel = employerSaidFormSchema.properties?.["channel"] as {
      oneOf: { const: string; title: string }[];
    };
    expect(channel.oneOf.map((each) => each.const)).toEqual([
      "",
      ...EMPLOYER_SAID_CHANNELS,
    ]);
    expect(channel.oneOf[0]?.title).toBe("Not said");
  });

  it("gives every field words and a place on a row", () => {
    const rows = (employerSaidUiSchema["ui:rows"] as unknown as unknown[][])
      .flat()
      .map((cell) =>
        typeof cell === "string" ? cell : (cell as { value: string }).value,
      );
    expect([...rows].sort()).toEqual([...names].sort());
    for (const name of names)
      expect(employerSaidUiSchema[name]).toHaveProperty("ui:title");
  });

  it("starts empty, and an empty form is not an entry", () => {
    expect(emptyEmployerSaid()).toEqual({
      said: "",
      saidBy: "",
      channel: "",
      saidOn: "",
    });
    expect(toEmployerSaidInput(emptyEmployerSaid())).toBeNull();
    expect(
      toEmployerSaidInput({ ...emptyEmployerSaid(), said: "  " }),
    ).toBeNull();
    expect(toEmployerSaidInput(null)).toBeNull();
  });

  it("round-trips a whole entry and leaves out what was left empty", () => {
    const whole = {
      said: "No AI assistants in live rounds.",
      saidBy: "Sam Reyes",
      channel: "email",
      saidOn: "2026-10-28",
    };
    expect(toEmployerSaidInput(whole)).toEqual(whole);
    expect(
      toEmployerSaidInput({ ...emptyEmployerSaid(), said: " Two rounds. " }),
    ).toEqual({ said: "Two rounds." });
    // A field the widget cleared to nothing is absent too.
    expect(
      toEmployerSaidInput({ said: "Two rounds.", saidBy: undefined }),
    ).toEqual({ said: "Two rounds." });
  });

  it("refuses what the contract refuses", () => {
    const said = { ...emptyEmployerSaid(), said: "Two rounds." };
    expect(toEmployerSaidInput({ ...said, saidOn: "28/10/2026" })).toBeNull();
    expect(toEmployerSaidInput({ ...said, channel: "fax" })).toBeNull();
    expect(toEmployerSaidInput({ ...said, other: "x" })).toBeNull();
  });
});
