// The bar's target title: the Interview (or candidacy) the session was linked
// to, read from the same choices list the setup view uses. It never blocks the
// bar: until the list answers, or if it cannot, the fallback title shows.
import type {
  LiveSessionChoicesResponse,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { fallbackTitle } from "./session-bar-model";
import { createSessionClient } from "./session-client";
import { tenantFromLocation } from "./session-registry";

// One read per tenant is shared by every bar mounted on every page; a failed
// read is dropped so the next mount tries again.
const reads = new Map<string, Promise<LiveSessionChoicesResponse>>();

export function resetTargetTitles(): void {
  reads.clear();
}

function choicesOf(tenant: string): Promise<LiveSessionChoicesResponse> {
  let read = reads.get(tenant);
  if (!read) {
    read = createSessionClient(tenant).choices();
    reads.set(tenant, read);
    read.catch(() => reads.delete(tenant));
  }
  return read;
}

function titleFromChoices(
  session: Pick<LiveSessionView, "interviewId" | "candidacyId">,
  choices: LiveSessionChoicesResponse,
): string | null {
  for (const candidacy of choices.candidacies) {
    const interview = candidacy.interviews.find(
      (item) => item.id === session.interviewId,
    );
    if (interview) return `${candidacy.title} · ${interview.label}`;
  }
  const candidacy = choices.candidacies.find(
    (item) => item.id === session.candidacyId,
  );
  return candidacy ? candidacy.title : null;
}

export function useSessionTarget(session: LiveSessionView): string {
  const linked = Boolean(session.interviewId || session.candidacyId);
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    setResolved(null);
    if (!linked) return;
    let current = true;
    choicesOf(tenantFromLocation()).then(
      (choices) => {
        if (current) setResolved(titleFromChoices(session, choices));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [linked, session.interviewId, session.candidacyId]);
  return resolved ?? fallbackTitle(session);
}
