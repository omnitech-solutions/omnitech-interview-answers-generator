// Reads the companion's last capability report (GET .../companion-capability).
// A read that fails keeps what was last read; with nothing read it is "error",
// which no screen turns into a claim. `refreshMs` re-reads on an interval (the
// report changes when the companion starts, after the panel is already open).
import type { LiveCompanionCapability } from "@omnitech/interview-contracts";
import { useEffect, useMemo, useState } from "react";
import { createSessionClient } from "./session-client";
import { tenantFromLocation } from "./session-registry";

export type CompanionCapabilityState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; capability: LiveCompanionCapability | null };

export const CAPABILITY_LOADING: CompanionCapabilityState = {
  status: "loading",
};

export function useCompanionCapability(
  refreshMs?: number,
): CompanionCapabilityState {
  const client = useMemo(() => createSessionClient(tenantFromLocation()), []);
  const [state, setState] =
    useState<CompanionCapabilityState>(CAPABILITY_LOADING);
  useEffect(() => {
    let alive = true;
    const read = () =>
      client.companionCapability().then(
        (capability) => {
          if (alive) setState({ status: "ready", capability });
        },
        () => {
          if (alive)
            setState((current) =>
              current.status === "ready" ? current : { status: "error" },
            );
        },
      );
    void read();
    const timer = refreshMs ? setInterval(read, refreshMs) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [client, refreshMs]);
  return state;
}
