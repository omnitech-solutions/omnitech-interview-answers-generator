import { createBriefingClient } from "@omnitech/interview-api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type QuestionSummary = {
  artifactId: string;
  title: string;
  kind: "coding" | "briefing";
  language: string | null;
  updatedAt: string;
};
export type BriefingSummary = { id: string; title: string; updatedAt: string };
export type StudioLists = {
  questions: readonly QuestionSummary[];
  briefings: readonly BriefingSummary[];
  status: "loading" | "ready" | "error";
  refresh(): void;
};

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

// The person's questions and saved briefings, for the sidebar and palette.
// Only the newest request's answer is shown; replaced requests are aborted.
export function useStudioLists({
  workspaceId,
  tenant,
}: {
  workspaceId: string;
  tenant: string;
}): StudioLists {
  const [questions, setQuestions] = useState<readonly QuestionSummary[]>([]);
  const [briefings, setBriefings] = useState<readonly BriefingSummary[]>([]);
  const [status, setStatus] = useState<StudioLists["status"]>("loading");
  const inFlight = useRef<AbortController | null>(null);
  const briefingClient = useMemo(
    () => createBriefingClient({ baseUrl: "", tenant }),
    [tenant],
  );

  const refresh = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void Promise.all([
      getJson<QuestionSummary[]>(
        `/api/interview/workspaces/${encodeURIComponent(workspaceId)}/artifacts`,
        controller.signal,
      ),
      // Briefings are optional: a host without them still lists questions.
      briefingClient
        .listArtifacts()
        .catch(() => ({ artifacts: [] as BriefingSummary[] })),
    ]).then(
      ([drafts, saved]) => {
        if (controller.signal.aborted) return;
        setQuestions(drafts.filter((item) => item.kind === "coding"));
        setBriefings(saved.artifacts);
        setStatus("ready");
      },
      () => {
        if (!controller.signal.aborted) setStatus("error");
      },
    );
  }, [workspaceId, briefingClient]);

  useEffect(() => {
    refresh();
    return () => inFlight.current?.abort();
  }, [refresh]);

  return { questions, briefings, status, refresh };
}
