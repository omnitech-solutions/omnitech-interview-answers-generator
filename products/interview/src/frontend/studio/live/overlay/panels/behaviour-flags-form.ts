// Settings › Behaviour as a declared form: every part of it is read from the
// registry (BEHAVIOUR_FLAGS in the contracts), so a flag added there is drawn,
// validated and saved here with no further code. The library's DynamicForm
// draws it; nothing in this file is React.
import {
  BEHAVIOUR_FLAGS,
  type BehaviourFlagDefinition,
  type BehaviourFlagState,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import type { FormSchema, FormUiSchema } from "../../../shared/contract-form";

export const NOT_SAVED = "Not saved. Try again.";

type Flags = readonly BehaviourFlagDefinition[];
export type FlagValues = Record<string, string>;

// What stands under a flag: who set it, when the host did, then what it does.
export const flagHelp = (
  flag: BehaviourFlagDefinition,
  state: BehaviourFlagState,
): string =>
  state.source === "environment"
    ? `Set by the environment (${flag.env}); change it there. ${flag.help}`
    : flag.help;

/** One choice per flag: its label, and each allowed value under its name. */
export function behaviourFlagsSchema(
  flags: Flags = BEHAVIOUR_FLAGS,
): FormSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      flags.map((flag) => [
        flag.env,
        {
          type: "string",
          title: flag.label,
          oneOf: flag.values.map((value) => ({
            const: value,
            title:
              (flag.options as Readonly<Record<string, string>>)[value] ??
              value,
          })),
        },
      ]),
    ),
  } as FormSchema;
}

/** The same rule as a parser: each flag holds one of its allowed values. */
export function behaviourFlagsValues(
  flags: Flags = BEHAVIOUR_FLAGS,
): z.ZodType<FlagValues> {
  return z.object(
    Object.fromEntries(flags.map((flag) => [flag.env, z.enum(flag.values)])),
  );
}

/**
 * How each flag is drawn for the state it is in: its help, read-only when the
 * host set it, and the one that did not save says so. A flag the Studio did
 * not answer for is not drawn.
 */
export function behaviourFlagsUiSchema(
  states: readonly BehaviourFlagState[],
  failed: string | null,
  flags: Flags = BEHAVIOUR_FLAGS,
): FormUiSchema {
  const ui: Record<string, unknown> = {
    "ui:rows": flags.map((flag) => [flag.env]),
  };
  for (const flag of flags) {
    const state = states.find((each) => each.key === flag.env);
    ui[flag.env] = state
      ? {
          "ui:widget": "select",
          "ui:description": flagHelp(flag, state),
          ...(state.source === "environment" ? { "ui:disabled": true } : {}),
          ...(failed === flag.env ? { "ui:help": NOT_SAVED } : {}),
        }
      : { "ui:widget": "hidden" };
  }
  return ui as FormUiSchema;
}

/** What the form shows: each flag's value in force, as the Studio said. */
export function toFlagValues(
  states: readonly BehaviourFlagState[],
  flags: Flags = BEHAVIOUR_FLAGS,
): FlagValues {
  const values: FlagValues = {};
  for (const flag of flags) {
    const state = states.find((each) => each.key === flag.env);
    if (state) values[flag.env] = state.value;
  }
  return values;
}

/** The one flag a change in the form asks for, or null when nothing moved. */
export function changedFlag(
  before: FlagValues,
  after: Record<string, unknown>,
): { key: string; value: string } | null {
  for (const [key, value] of Object.entries(after))
    if (key in before && typeof value === "string" && before[key] !== value)
      return { key, value };
  return null;
}
