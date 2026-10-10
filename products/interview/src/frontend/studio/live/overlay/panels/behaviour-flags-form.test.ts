// Settings › Behaviour as data: the form's schema, its drawing and its values
// are all read from the registry, so a new flag needs no code.
import {
  BEHAVIOUR_FLAGS,
  type BehaviourFlagDefinition,
  type BehaviourFlagState,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  behaviourFlagsSchema,
  behaviourFlagsUiSchema,
  behaviourFlagsValues,
  changedFlag,
  NOT_SAVED,
  toFlagValues,
} from "./behaviour-flags-form";

const states = (
  flags: readonly BehaviourFlagDefinition[] = BEHAVIOUR_FLAGS,
): BehaviourFlagState[] =>
  flags.map((flag) => ({
    key: flag.env,
    value: flag.default,
    source: "default",
    stored: null,
    default: flag.default,
  }));

// A flag no screen knows: the registry is the only place it is written.
const NEW_FLAG = {
  ...BEHAVIOUR_FLAGS[0],
  env: "A_FLAG_ADDED_LATER",
  label: "A flag added later",
  help: "What it does.",
  values: ["slow", "fast"],
  default: "slow",
  options: { slow: "Slowly", fast: "Quickly" },
} as unknown as BehaviourFlagDefinition;

describe("the behaviour flags form", () => {
  it("has one choice per flag in the registry, in its order, named by its label, with each allowed value under its name", () => {
    const schema = behaviourFlagsSchema();
    expect(Object.keys(schema.properties ?? {})).toEqual(
      BEHAVIOUR_FLAGS.map((flag) => flag.env),
    );
    for (const flag of BEHAVIOUR_FLAGS)
      expect(schema.properties?.[flag.env]).toEqual({
        type: "string",
        title: flag.label,
        oneOf: flag.values.map((value) => ({
          const: value,
          title: (flag.options as Record<string, string>)[value],
        })),
      });
  });

  it("draws a flag added to the registry with no other change", () => {
    const flags = [...BEHAVIOUR_FLAGS, NEW_FLAG];
    expect(behaviourFlagsSchema(flags).properties?.[NEW_FLAG.env]).toEqual({
      type: "string",
      title: "A flag added later",
      oneOf: [
        { const: "slow", title: "Slowly" },
        { const: "fast", title: "Quickly" },
      ],
    });
    const ui = behaviourFlagsUiSchema(states(flags), null, flags);
    expect(ui[NEW_FLAG.env]).toEqual({
      "ui:widget": "select",
      "ui:description": "What it does.",
    });
    expect(toFlagValues(states(flags), flags)[NEW_FLAG.env]).toBe("slow");
    const values = behaviourFlagsValues(flags);
    expect(
      values.safeParse({ ...toFlagValues(states(flags), flags) }).success,
    ).toBe(true);
    expect(
      values.safeParse({
        ...toFlagValues(states(flags), flags),
        [NEW_FLAG.env]: "sideways",
      }).success,
    ).toBe(false);
  });

  it("puts each flag on a row of its own", () => {
    expect(behaviourFlagsUiSchema(states(), null)["ui:rows"]).toEqual(
      BEHAVIOUR_FLAGS.map((flag) => [flag.env]),
    );
  });

  it("makes a flag the host set read-only and says who set it; says which one did not save", () => {
    const [first, second] = BEHAVIOUR_FLAGS;
    const held = states().map((state) =>
      state.key === first.env
        ? { ...state, source: "environment" as const }
        : state,
    );
    const ui = behaviourFlagsUiSchema(held, second.env) as Record<
      string,
      Record<string, unknown>
    >;
    expect(ui[first.env]?.["ui:disabled"]).toBe(true);
    expect(ui[first.env]?.["ui:description"]).toBe(
      `Set by the environment (${first.env}); change it there. ${first.help}`,
    );
    expect(ui[first.env]).not.toHaveProperty("ui:help");
    expect(ui[second.env]).not.toHaveProperty("ui:disabled");
    expect(ui[second.env]?.["ui:help"]).toBe(NOT_SAVED);
  });

  it("does not draw a flag the Studio did not answer for", () => {
    const [first, ...rest] = BEHAVIOUR_FLAGS;
    const ui = behaviourFlagsUiSchema(states(rest), null);
    expect(ui[first.env]).toEqual({ "ui:widget": "hidden" });
    expect(toFlagValues(states(rest))).not.toHaveProperty(first.env);
  });

  it("round-trips the values: what the Studio said is what the form shows, and an unchanged form asks for nothing", () => {
    const values = toFlagValues(states());
    expect(values).toEqual(
      Object.fromEntries(
        BEHAVIOUR_FLAGS.map((flag) => [flag.env, flag.default]),
      ),
    );
    expect(behaviourFlagsValues().parse(values)).toEqual(values);
    expect(changedFlag(values, { ...values })).toBeNull();
  });

  it("names the one flag a change asks for, and ignores what is not a flag's value", () => {
    const values = toFlagValues(states());
    const flag = BEHAVIOUR_FLAGS[1];
    expect(changedFlag(values, { ...values, [flag.env]: "codex" })).toEqual({
      key: flag.env,
      value: "codex",
    });
    expect(
      changedFlag(values, { ...values, [flag.env]: undefined }),
    ).toBeNull();
    expect(changedFlag(values, { ...values, UNKNOWN: "on" })).toBeNull();
  });
});
