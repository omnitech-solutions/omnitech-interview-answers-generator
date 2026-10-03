import { createPlanClient } from "@omnitech/interview-api-client";
import type {
  InterviewPlanInput,
  PlanItemInput,
  PlanItemPatch,
  PlanResponse,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { studioFetch, studioFetchUntil } from "../studio-fetch";

// The interview being prepared for and its plan. Every change returns the
// whole plan, which replaces what is shown.
export function usePlan() {
  const client = useMemo(
    () => createPlanClient({ baseUrl: "", fetch: studioFetch }),
    [],
  );
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState("");

  // A change whose view has gone (its signal aborted) is not shown.
  const apply = useCallback(
    async (change: Promise<PlanResponse>, signal?: AbortSignal) => {
      try {
        const next = await change;
        if (signal?.aborted) return;
        setPlan(next);
        setError("");
      } catch (failure) {
        if (signal?.aborted) return;
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    },
    [],
  );

  // The first load ends with the view, so a re-run leaves one live request.
  useEffect(() => {
    const controller = new AbortController();
    const loader = createPlanClient({
      baseUrl: "",
      fetch: studioFetchUntil(controller.signal),
    });
    void apply(loader.get(), controller.signal);
    return () => controller.abort();
  }, [apply]);

  return {
    plan,
    error,
    reload: () => apply(client.get()),
    saveInterview: (input: InterviewPlanInput & { id?: string | null }) =>
      apply(client.saveInterview(input)),
    addItem: (input: PlanItemInput) => apply(client.addItem(input)),
    updateItem: (id: string, patch: PlanItemPatch) =>
      apply(client.updateItem(id, patch)),
    removeItem: (id: string) => apply(client.removeItem(id)),
  };
}
export type PlanState = ReturnType<typeof usePlan>;
