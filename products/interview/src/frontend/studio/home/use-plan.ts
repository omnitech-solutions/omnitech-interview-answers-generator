import { createPlanClient } from "@omnitech/interview-api-client";
import type {
  InterviewPlanInput,
  PlanItemInput,
  PlanItemPatch,
  PlanResponse,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

// The interview being prepared for and its plan. Every change returns the
// whole plan, which replaces what is shown.
export function usePlan() {
  const client = useMemo(() => createPlanClient({ baseUrl: "" }), []);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState("");

  const apply = useCallback(async (change: Promise<PlanResponse>) => {
    try {
      setPlan(await change);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => {
    void apply(client.get());
  }, [apply, client]);

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
