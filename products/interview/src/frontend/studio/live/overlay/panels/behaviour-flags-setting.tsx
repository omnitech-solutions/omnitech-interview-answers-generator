// Settings › Behaviour: the product's behaviour flags (BEHAVIOUR_FLAGS in the
// contracts), one control per row of the registry. The Studio holds them; this
// reads what is in force and changes one at a time. A flag the host set in the
// environment is shown as it is and cannot be changed here. Until the Studio
// has answered there is nothing to show, rather than a control that may lie.
//
// [SAFETY] Each line of help says what the flag really does and when a change
// takes hold; the words are the registry's, so they cannot drift from it.
import { Divider, Select } from "@oc-tech/omni-ui-components";
import {
  BEHAVIOUR_FLAGS,
  type BehaviourFlagDefinition,
  type BehaviourFlagState,
  behaviourFlagsResponseSchema,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useState } from "react";
import { TENANT_HEADER } from "../../../studio-fetch";
import { windowTenant } from "./use-account";

const ENDPOINT = "/api/v1/behaviour-flags";
export const NOT_SAVED = "Not saved. Try again.";

const stateOf = async (response: Response) =>
  response.ok
    ? behaviourFlagsResponseSchema.parse(await response.json()).flags
    : null;

// The flags as the Studio holds them, and the one way to change one. A failed
// change keeps what is on show and names the flag it failed for.
export function useBehaviourFlags(): {
  flags: readonly BehaviourFlagState[] | null;
  failed: string | null;
  choose(key: string, value: string): Promise<void>;
} {
  const [flags, setFlags] = useState<readonly BehaviourFlagState[] | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(ENDPOINT, { headers: { [TENANT_HEADER]: windowTenant() } })
      .then(stateOf)
      .then(
        (next) => live && next && setFlags(next),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, []);
  const choose = useCallback(async (key: string, value: string) => {
    setFailed(null);
    try {
      const next = await stateOf(
        await fetch(ENDPOINT, {
          method: "PUT",
          headers: {
            [TENANT_HEADER]: windowTenant(),
            "content-type": "application/json",
          },
          body: JSON.stringify({ key, value }),
        }),
      );
      if (next) setFlags(next);
      else setFailed(key);
    } catch {
      setFailed(key);
    }
  }, []);
  return { flags, failed, choose };
}

// What stands under a flag: who set it, when the host did, then what it does.
export const flagHelp = (
  flag: BehaviourFlagDefinition,
  state: BehaviourFlagState,
): string =>
  state.source === "environment"
    ? `Set by the environment (${flag.env}); change it there. ${flag.help}`
    : flag.help;

export function BehaviourFlagsSetting() {
  const { flags, failed, choose } = useBehaviourFlags();
  if (!flags) return null;
  return (
    <>
      <Divider>Behaviour</Divider>
      {BEHAVIOUR_FLAGS.map((flag) => {
        const state = flags.find((each) => each.key === flag.env);
        if (!state) return null;
        return (
          <Select
            key={flag.env}
            label={flag.label}
            description={flagHelp(flag, state)}
            data-testid={`pn-flag-${flag.env}`}
            value={state.value}
            disabled={state.source === "environment"}
            {...(failed === flag.env ? { error: NOT_SAVED } : {})}
            onChange={(value) => void choose(flag.env, value)}
            options={flag.values.map((value) => ({
              value,
              label:
                (flag.options as Readonly<Record<string, string>>)[value] ??
                value,
            }))}
          />
        );
      })}
    </>
  );
}
