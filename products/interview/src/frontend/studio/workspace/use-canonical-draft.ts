import type {
  GeneratedAnswer,
  RunResult,
  SavedAnswer,
  StageProgress,
} from "@omnitech/interview-contracts";
import type { Origin } from "@omnitech-assistant/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { studioFetch } from "../studio-fetch";

export type Draft = {
  question: string;
  notes: string;
  answer: GeneratedAnswer | null;
  progress?: StageProgress | undefined;
};
// What marks a draft as created by something other than its owner (an
// assistant proposal or a session). An owner edit of the answer, briefing or
// question clears it; any other edit moves `draftRevision` past
// `acceptedDraftRevision`.
export type DraftProvenance = {
  proposalId: string;
  draftRevision: number;
  acceptedDraftRevision: number;
};
type CanonicalRecord = {
  origin: Origin;
  value: Draft;
  provenance?: DraftProvenance | null;
};
export type SaveState = "saved" | "saving" | "unsaved" | "conflict" | "error";

const AUTOSAVE_MS = 800;
// The server names a question it created on first read.
export const PLACEHOLDER_QUESTION = "New interview question";

class WorkspaceRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// One question's canonical draft on the server, edited locally and saved back
// shortly after each change. Saving here keeps the draft; an immutable answer
// version is a separate, explicit save.
export function useCanonicalDraft({
  workspaceId,
  artifactId,
  onLoaded,
  onRenamed,
}: {
  workspaceId: string;
  artifactId: string;
  onLoaded?: () => void;
  // The question or title changed on the server: lists naming it are stale.
  onRenamed?: () => void;
}) {
  const path = `/api/interview/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [origin, setOrigin] = useState<Origin>();
  const [provenance, setProvenance] = useState<DraftProvenance | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [loadError, setLoadError] = useState("");
  // Refs mirror state for async work that must see the latest values.
  const working = useRef<Draft | null>(null);
  const canonical = useRef("");
  const originRef = useRef<Origin | undefined>(undefined);
  const pending = useRef<Promise<Origin> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const effectKeys = useRef<
    Record<string, { fingerprint: string; id: string }>
  >({});
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const renamed = useRef(onRenamed);
  renamed.current = onRenamed;

  const request = useCallback(
    async <T>(suffix: string, init?: RequestInit): Promise<T> => {
      const response = await studioFetch(path + suffix, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new WorkspaceRequestError(
          (body as { code?: string }).code ?? "workspace-request-failed",
        );
      return body as T;
    },
    [path],
  );

  const hydrate = useCallback((record: CanonicalRecord) => {
    originRef.current = record.origin;
    setOrigin(record.origin);
    setProvenance(record.provenance ?? null);
    canonical.current = JSON.stringify(record.value);
    working.current = record.value;
    setDraft(record.value);
    setSaveState("saved");
  }, []);

  // [STRATEGY] Saves are serialised: one PATCH at a time, against the last
  // revision the server confirmed. Edits made meanwhile are saved next.
  const flush = useCallback(async (): Promise<Origin> => {
    if (pending.current) await pending.current.catch(() => undefined);
    const expected = originRef.current;
    if (!expected || !working.current) throw new Error("workspace-not-ready");
    const captured = working.current;
    if (JSON.stringify(captured) === canonical.current) return expected;
    setSaveState("saving");
    const operation = request<CanonicalRecord>("", {
      method: "PATCH",
      body: JSON.stringify({ origin: expected, patch: captured }),
    }).then((record) => {
      const before = JSON.parse(canonical.current || "null") as Draft | null;
      if (
        before?.question !== record.value.question ||
        before?.answer?.title !== record.value.answer?.title
      )
        renamed.current?.();
      originRef.current = record.origin;
      setOrigin(record.origin);
      setProvenance(record.provenance ?? null);
      canonical.current = JSON.stringify(record.value);
      // The server renders Markdown from the guide; keep its answer unless
      // the person has typed since.
      if (working.current === captured) {
        working.current = record.value;
        setDraft(record.value);
        setSaveState("saved");
      } else setSaveState("unsaved");
      return record.origin;
    });
    pending.current = operation;
    try {
      return await operation;
    } catch (error) {
      setSaveState(
        error instanceof WorkspaceRequestError &&
          error.code === "revision-conflict"
          ? "conflict"
          : "error",
      );
      throw error;
    } finally {
      if (pending.current === operation) pending.current = null;
    }
  }, [request]);

  // Edits are computed from the latest draft, not from the last render, so
  // quick successive edits (two ticks in one frame) all land.
  const update = useCallback(
    (patch: Partial<Draft> | ((current: Draft) => Partial<Draft>)) => {
      if (!working.current) return;
      const next = {
        ...working.current,
        ...(typeof patch === "function" ? patch(working.current) : patch),
      };
      working.current = next;
      setDraft(next);
      setSaveState("unsaved");
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => void flush().catch(() => undefined),
        AUTOSAVE_MS,
      );
    },
    [flush],
  );

  // [SAFETY] Replaces part of the draft with something the person chose to
  // take (a held session result). Their own pending edits are saved first, and
  // the replacement is saved against the revision they have seen, so a draft
  // that moved elsewhere is refused (revision-conflict) rather than overwritten.
  // A refusal leaves the draft as it was.
  const replace = useCallback(
    async (patch: (current: Draft) => Partial<Draft>) => {
      clearTimeout(timer.current);
      await flush();
      const base = working.current;
      if (!base) throw new Error("workspace-not-ready");
      const next = { ...base, ...patch(base) };
      working.current = next;
      setDraft(next);
      try {
        await flush();
      } catch (error) {
        if (working.current === next) {
          working.current = base;
          setDraft(base);
        }
        throw error;
      }
    },
    [flush],
  );

  const reload = useCallback(async () => {
    hydrate(await request<CanonicalRecord>(""));
  }, [hydrate, request]);

  // After the assistant changes the draft, show the stored version, unless
  // the person edited meanwhile: their edits are never overwritten.
  const reloadAfterAssistant = useCallback(
    async (captured: Origin): Promise<boolean> => {
      const snapshot = working.current;
      const record = await request<CanonicalRecord>("");
      if (
        originRef.current?.artifactId !== captured.artifactId ||
        working.current !== snapshot ||
        JSON.stringify(snapshot) !== canonical.current
      )
        return false;
      hydrate(record);
      return true;
    },
    [hydrate, request],
  );

  // An effect (save, run) is idempotent per draft revision.
  const effectKey = useCallback((kind: string, at: Origin) => {
    const fingerprint = JSON.stringify(at);
    const prior = effectKeys.current[kind];
    if (prior?.fingerprint === fingerprint) return prior.id;
    const id = crypto.randomUUID();
    effectKeys.current[kind] = { fingerprint, id };
    return id;
  }, []);

  const runTests = useCallback(async (): Promise<RunResult> => {
    const at = await flush();
    const result = await request<{ execution: RunResult }>("/run-code", {
      method: "POST",
      body: JSON.stringify({
        origin: at,
        requestId: effectKey("run-code", at),
      }),
    });
    return result.execution;
  }, [effectKey, flush, request]);

  const saveVersion = useCallback(async () => {
    const at = await flush();
    await request("/save", {
      method: "POST",
      body: JSON.stringify({ origin: at, requestId: effectKey("save", at) }),
    });
  }, [effectKey, flush, request]);

  const listVersions = useCallback(async () => {
    const response = await studioFetch(`${path}/versions`);
    if (!response.ok) throw new Error("versions-unavailable");
    return (await response.json()) as SavedAnswer[];
  }, [path]);

  // The draft's load ends with the view, so a re-run leaves one live request.
  useEffect(() => {
    const controller = new AbortController();
    void request<CanonicalRecord>("", { signal: controller.signal }).then(
      (record) => {
        if (controller.signal.aborted) return;
        hydrate(record);
        loaded.current?.();
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [hydrate, request]);
  // Leaving the question saves what was typed since the last save.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (
        working.current &&
        JSON.stringify(working.current) !== canonical.current
      )
        void flushRef.current().catch(() => undefined);
    },
    [],
  );

  return {
    draft,
    origin,
    provenance,
    saveState,
    loadError,
    update,
    flush,
    replace,
    reload,
    reloadAfterAssistant,
    runTests,
    saveVersion,
    listVersions,
  };
}
export type CanonicalDraft = ReturnType<typeof useCanonicalDraft>;
