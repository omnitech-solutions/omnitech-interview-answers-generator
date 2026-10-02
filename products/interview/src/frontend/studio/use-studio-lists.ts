import {
  createBriefingClient,
  createBriefsClient,
} from "@omnitech/interview-api-client";
import type { BriefSummary as ConceptBriefSummary } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { studioFetch } from "./studio-fetch";

export type QuestionSummary = {
  artifactId: string;
  title: string;
  kind: "coding" | "briefing";
  language: string | null;
  updatedAt: string;
  // The latest test run, if any (see the drafts listing).
  lastRun?: {
    ok: boolean;
    passed: number | null;
    total: number | null;
    at: string;
  } | null;
};
export type BriefingSummary = { id: string; title: string; updatedAt: string };
export type StudioLists = {
  questions: readonly QuestionSummary[];
  // Behavioural preparation packs.
  briefings: readonly BriefingSummary[];
  // Spoken briefs on concepts and system design.
  briefs: readonly ConceptBriefSummary[];
  status: "loading" | "ready" | "error";
  refresh(): void;
};

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await studioFetch(url, { signal });
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
  const [briefs, setBriefs] = useState<readonly ConceptBriefSummary[]>([]);
  const [status, setStatus] = useState<StudioLists["status"]>("loading");
  const inFlight = useRef<AbortController | null>(null);
  const briefingClient = useMemo(
    () => createBriefingClient({ baseUrl: "", tenant }),
    [tenant],
  );
  const briefsClient = useMemo(
    () => createBriefsClient({ baseUrl: "", fetch: studioFetch }),
    [],
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
      briefsClient.list().catch(() => [] as ConceptBriefSummary[]),
    ]).then(
      ([drafts, saved, spoken]) => {
        if (controller.signal.aborted) return;
        setQuestions(drafts.filter((item) => item.kind === "coding"));
        setBriefings(saved.artifacts);
        setBriefs(spoken);
        setStatus("ready");
      },
      () => {
        if (!controller.signal.aborted) setStatus("error");
      },
    );
  }, [workspaceId, briefingClient, briefsClient]);

  useEffect(() => {
    refresh();
    return () => inFlight.current?.abort();
  }, [refresh]);

  return { questions, briefings, briefs, status, refresh };
}
