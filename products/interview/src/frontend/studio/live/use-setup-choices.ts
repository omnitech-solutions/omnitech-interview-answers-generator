// Loads what the Setup view offers to link (GET .../sessions/choices): the
// owner's candidacies with their interviews and their experience matrices. One
// read on mount; `reload` reads again (after a refused link, or Try again).
import type { LiveSessionChoicesResponse } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSessionClient } from "./session-client";
import { tenantFromLocation } from "./session-registry";

export type SetupChoices =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; choices: LiveSessionChoicesResponse };

export function useSetupChoices(): {
  state: SetupChoices;
  reload(): void;
} {
  const client = useMemo(() => createSessionClient(tenantFromLocation()), []);
  const [state, setState] = useState<SetupChoices>({ status: "loading" });
  // Only the newest read may answer, and none after unmount.
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    setState({ status: "loading" });
    client.choices().then(
      (choices) => {
        if (latest.current === mine) setState({ status: "ready", choices });
      },
      () => {
        if (latest.current === mine) setState({ status: "error" });
      },
    );
  }, [client]);
  useEffect(() => {
    load();
    return () => {
      latest.current = -1;
    };
  }, [load]);
  return { state, reload: load };
}
