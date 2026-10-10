// Settings › Behaviour: the product's behaviour flags (BEHAVIOUR_FLAGS in the
// contracts), one control per row of the registry. The Studio holds them; this
// reads what is in force and changes one at a time. A flag the host set in the
// environment is shown as it is and cannot be changed here. Until the Studio
// has answered there is nothing to show, rather than a control that may lie.
//
// [SAFETY] Each line of help says what the flag really does and when a change
// takes hold; the words are the registry's, so they cannot drift from it.
//
// [STRATEGY] The section is a declared form (behaviour-flags-form.ts): its
// schema, its help and its read-only state are all read from the registry and
// drawn by the library's DynamicForm. A new flag needs no code here.
import { Divider } from "@oc-tech/omni-ui-components";
import { DynamicForm } from "@oc-tech/omni-ui-components/dynamic-form";
import {
  type BehaviourFlagState,
  behaviourFlagsResponseSchema,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formParser } from "../../../shared/contract-form";
import { TENANT_HEADER } from "../../../studio-fetch";
import {
  behaviourFlagsSchema,
  behaviourFlagsUiSchema,
  behaviourFlagsValues,
  changedFlag,
  toFlagValues,
} from "./behaviour-flags-form";
import { windowTenant } from "./use-account";

export { flagHelp, NOT_SAVED } from "./behaviour-flags-form";

const ENDPOINT = "/api/v1/behaviour-flags";
// The registry does not change while the app runs: read once.
const SCHEMA = behaviourFlagsSchema();
const VALUES = formParser(behaviourFlagsValues());

const stateOf = async (response: Response) =>
  response.ok
    ? behaviourFlagsResponseSchema.parse(await response.json()).flags
    : null;

// The flags as the Studio holds them, and the one way to change one. A failed
// change keeps what is on show and names the flag it failed for.
export function useBehaviourFlags(): {
  flags: readonly BehaviourFlagState[] | null;
  failed: string | null;
  // How many changes have not saved, so the form can be drawn again.
  failures: number;
  choose(key: string, value: string): Promise<void>;
} {
  const [flags, setFlags] = useState<readonly BehaviourFlagState[] | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
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
    const refused = () => {
      setFailed(key);
      setFailures((count) => count + 1);
    };
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
      else refused();
    } catch {
      refused();
    }
  }, []);
  return { flags, failed, failures, choose };
}

export function BehaviourFlagsSetting() {
  const { flags, failed, failures, choose } = useBehaviourFlags();
  const values = useMemo(() => (flags ? toFlagValues(flags) : null), [flags]);
  const uiSchema = useMemo(
    () => (flags ? behaviourFlagsUiSchema(flags, failed) : null),
    [flags, failed],
  );
  if (!values || !uiSchema) return null;
  return (
    <>
      <Divider>Behaviour</Divider>
      {/* A change is saved as it is made (no Save button). The form holds what
          was chosen, so after a change that did not save it is drawn again
          from what the Studio still holds. */}
      <DynamicForm
        key={failures}
        schema={SCHEMA}
        uiSchema={uiSchema}
        zodSchema={VALUES}
        formData={values}
        onChange={(next) => {
          const change = changedFlag(values, next);
          if (change) void choose(change.key, change.value);
        }}
        onSubmit={() => undefined}
      />
    </>
  );
}
