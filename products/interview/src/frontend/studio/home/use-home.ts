import {
  interviewPlanInputSchema,
  type PlanItem,
  planItemInputSchema,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import type { StudioActions } from "../config/commands";
import type { StudioLists } from "../use-studio-lists";
import { interviewForm, planItemForm } from "./home-config";
import { usePlan } from "./use-plan";

export function useHome({
  actions: studio,
  lists,
}: {
  actions: StudioActions;
  lists: StudioLists;
}) {
  const plan = usePlan();
  const [editing, setEditing] = useState(false);
  const [interviewDraft, setInterviewDraft] = useState(interviewForm.defaults);
  const [itemDraft, setItemDraft] = useState(planItemForm.defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitBusy = useRef(false);
  const addBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const interview = plan.plan?.interview ?? null;
  const open = (item: PlanItem) => {
    if (item.kind === "question" && item.ref) studio.openArtifact(item.ref);
    else if (item.kind === "briefing" && item.ref)
      studio.openBriefing(item.ref);
    else if (item.kind === "rehearsal") studio.go("rehearsal");
  };
  async function saveInterview() {
    if (submitBusy.current) return;
    const parsed = interviewPlanInputSchema.safeParse(interviewDraft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check interview details.");
      return;
    }
    submitBusy.current = true;
    setSaving(true);
    setError("");
    try {
      await plan.saveInterview({ ...parsed.data, id: interview?.id ?? null });
    } finally {
      submitBusy.current = false;
      if (mounted.current) setSaving(false);
    }
    // usePlan owns request errors. Keep the draft open until the caller sees
    // the returned plan; do not hide an unsaved draft after a failed request.
  }
  async function addItem(input = itemDraft) {
    if (addBusy.current) return;
    const parsed = planItemInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the item.");
      return;
    }
    addBusy.current = true;
    setError("");
    try {
      await plan.addItem(parsed.data);
    } finally {
      addBusy.current = false;
    }
  }
  return {
    status:
      error || plan.error
        ? ("error" as const)
        : plan.plan
          ? ("ready" as const)
          : ("loading" as const),
    error: error || plan.error,
    interview,
    items: plan.plan?.items ?? [],
    recent: lists.questions.slice(0, 8),
    form: {
      editing,
      saving,
      interview: interviewDraft,
      item: itemDraft,
      setInterview: setInterviewDraft,
      setItem: setItemDraft,
    },
    actions: {
      open,
      complete: (item: PlanItem) => plan.updateItem(item.id, { done: true }),
      reopen: (item: PlanItem) => plan.updateItem(item.id, { done: false }),
      remove: (item: PlanItem) => plan.removeItem(item.id),
      editInterview: () => {
        setInterviewDraft(
          interview
            ? {
                company: interview.company,
                role: interview.role,
                scheduledAt: interview.scheduledAt,
                durationMinutes: interview.durationMinutes,
                format: interview.format,
                topics: [...interview.topics],
              }
            : interviewForm.defaults,
        );
        setEditing(true);
      },
      cancelEdit: () => setEditing(false),
      saveInterview,
      addItem,
      retry: plan.reload,
      refreshRecent: lists.refresh,
      openRecent: studio.openArtifact,
      newQuestion: studio.newQuestion,
      startRehearsal: () => studio.go("rehearsal"),
    },
  };
}
