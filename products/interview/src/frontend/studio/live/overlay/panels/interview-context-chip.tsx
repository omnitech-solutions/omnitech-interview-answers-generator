// The task bar's interview context: which company and role this session is
// for, and the door to its job spec, notes and employer brief. Reads the
// candidacy once per id; absent when the session was started as a rehearsal.
import { Button } from "@oc-tech/omni-ui-components";
import type { CandidacyContext } from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { documentJson } from "../../../documents/documents-client";
import { Icon } from "../../../icon";
import { InterviewContextModal } from "./interview-context-modal";

export function InterviewContextChip({
  candidacyId,
}: {
  candidacyId: string | null;
}) {
  const [context, setContext] = useState<CandidacyContext | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setContext(null);
    if (!candidacyId) return;
    let live = true;
    documentJson<CandidacyContext>(
      `/candidacies/${encodeURIComponent(candidacyId)}/context`,
    ).then(
      (loaded) => {
        if (live) setContext(loaded);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [candidacyId]);
  if (!candidacyId) return null;
  const label = context
    ? `${context.companyName} · ${context.title}`
    : "Interview context";
  return (
    <>
      <Button
        buttonSize="sm"
        variant="ghost"
        icon={<Icon name="work" />}
        labelMaxWidth="220px"
        className="pn-context-chip"
        aria-label={`Interview context: ${label}${context?.brief ? " (brief ready)" : ""}`}
        onClick={() => setOpen(true)}
        data-testid="pn-context-chip"
      >
        {label}
      </Button>
      <InterviewContextModal
        open={open}
        candidacyId={candidacyId}
        onOpenChange={setOpen}
        onSaved={setContext}
      />
    </>
  );
}
