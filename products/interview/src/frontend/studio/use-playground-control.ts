import type {
  PlaygroundExplanation,
  PlaygroundSnapshot,
} from "@omnitech/interview-playground-control";
import { useEffect, useRef, useState } from "react";
import {
  CONTROL_PATH,
  type ControlPlan,
  explanationsOf,
  isNewSnapshot,
  planControl,
  type RehearsalCommand,
  readApplied,
  storeApplied,
  writeControlDraft,
} from "./playground-control";
import type { StudioNavigation } from "./use-studio-route";

const POLL_MS = 500;

export type PlaygroundControlState = {
  explanations: readonly PlaygroundExplanation[];
  rehearsal: RehearsalCommand | null;
};

// Follows the Playground control channel while the studio is visible and
// applies each new push once. The channel is optional: when it is missing
// or failing, the studio carries on and the next poll retries.
export function usePlaygroundControl(options: {
  workspaceId: string;
  navigate(next: StudioNavigation): void;
  refreshLists(): void;
  // The open Workspace reloads a draft the channel rewrote.
  reloadDraft(artifact: string): void;
  // [GUARD] While true the push waits: nothing is applied over unsaved
  // preparation or into a live rehearsal it was not meant for.
  busy(plan: ControlPlan): boolean;
}): PlaygroundControlState {
  const [explanations, setExplanations] = useState<
    readonly PlaygroundExplanation[]
  >([]);
  const [rehearsal, setRehearsal] = useState<RehearsalCommand | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    let active = true;
    let polling = false;

    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(CONTROL_PATH, { cache: "no-store" });
        if (!response.ok || !active) return;
        const snapshot = (await response.json()) as PlaygroundSnapshot;
        // Explanations always mirror the channel, applied or not.
        const pushed = explanationsOf(snapshot);
        setExplanations((current) =>
          JSON.stringify(current) === JSON.stringify(pushed) ? current : pushed,
        );

        const applied = readApplied();
        if (!isNewSnapshot(snapshot, applied)) return;
        const plan = planControl(
          snapshot,
          applied,
          () => `q-${Date.now().toString(36)}`,
        );
        const host = latest.current;
        if (host.busy(plan)) return;

        if (plan.write) {
          try {
            await writeControlDraft(
              host.workspaceId,
              plan.write.artifact,
              plan.write.draft,
            );
            if (!plan.write.created) host.reloadDraft(plan.write.artifact);
            host.refreshLists();
          } catch {
            // [SAFETY] A draft the server refuses is not retried every poll;
            // `interview-answers playground show` still has the push.
          }
        }
        storeApplied(plan.applied);
        if (!active) return;
        if (plan.rehearsal) setRehearsal(plan.rehearsal);
        if (plan.navigate) host.navigate(plan.navigate);
      } catch {
        // The channel is optional; the next poll retries.
      } finally {
        polling = false;
      }
    }

    void poll();
    // A hidden tab has nobody watching it; it catches up when shown.
    const timer = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    const resume = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  return { explanations, rehearsal };
}
