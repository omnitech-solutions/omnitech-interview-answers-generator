import {
  type BriefsClient,
  createBriefsClient,
} from "@omnitech/interview-api-client";
import { type Brief, briefRequestSchema } from "@omnitech/interview-contracts";
import type { PlaygroundExplanation } from "@omnitech/interview-playground-control";
import { useEffect, useMemo, useRef, useState } from "react";
import { conceptBriefAssistant } from "../../assistant-config";
import type { StudioActions } from "../config/commands";
import { useStudio } from "../context";
import { studioFetch } from "../studio-fetch";
import type { StudioLists } from "../use-studio-lists";
import { newBriefForm } from "./briefings-config";

export type BriefSelection =
  | { kind: "new" }
  | { kind: "brief"; id: string }
  | { kind: "explanations" }
  | { kind: "pack"; id: string; draft: boolean };
export function briefSelectionOf(rest: readonly string[]): BriefSelection {
  if (rest[0] === "explanations" && rest.length === 1)
    return { kind: "explanations" };
  if (rest[0] === "brief" && rest[1]) return { kind: "brief", id: rest[1] };
  if (rest[0]) return { kind: "pack", id: rest[0], draft: rest[1] === "draft" };
  return { kind: "new" };
}
export function useBriefings({
  rest,
  actions: studioActions,
  lists,
  explanations = [],
  client: supplied,
}: {
  rest: readonly string[];
  actions: StudioActions;
  lists: StudioLists;
  explanations?: readonly PlaygroundExplanation[];
  client?: BriefsClient;
}) {
  const studio = useStudio();
  const client = useMemo(
    () => supplied ?? createBriefsClient({ baseUrl: "", fetch: studioFetch }),
    [supplied],
  );
  const selection = briefSelectionOf(rest);
  const selected = selection.kind === "brief" ? selection.id : null;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [values, setValues] = useState(newBriefForm.defaults);
  const operation = useRef(false);
  const mounted = useRef(true);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setBrief(null);
    setLoadError("");
    if (selected)
      void client.get(selected).then(
        (loaded) => {
          if (active) setBrief(loaded);
        },
        () => {
          if (active) setLoadError("This brief couldn’t be loaded.");
        },
      );
    return () => {
      active = false;
    };
  }, [selected, client]);
  const openBrief = brief?.id === selected ? selected : null;
  useEffect(() => {
    if (!studio || !openBrief) return;
    return studio.bindView({
      origin: {
        workspaceId: "concept-briefs",
        artifactId: openBrief,
        artifactRevision: 0,
      },
      assistant: conceptBriefAssistant,
    });
  }, [studio, openBrief]);
  async function build() {
    if (operation.current) return;
    const parsed = briefRequestSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a topic.");
      return;
    }
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      const built = await client.build(parsed.data);
      if (mounted.current) {
        lists.refresh();
        studioActions.openBrief(built.id);
      }
    } catch {
      if (mounted.current)
        setError(
          "The briefing couldn’t be built. Check the model is running, then try again.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function remove() {
    if (!selected || operation.current) return;
    const id = selected;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await client.remove(id);
      if (mounted.current) {
        lists.refresh();
        if (selectedRef.current === id) studioActions.go("briefings");
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "This brief couldn’t be deleted.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const entries = [
    ...lists.briefs.map((item) => ({
      key: `brief:${item.id}`,
      id: item.id,
      title: item.title,
      kind: item.kind,
      updatedAt: item.updatedAt,
    })),
    ...lists.briefings.map((item) => ({
      key: `pack:${item.id}`,
      id: item.id,
      title: item.title,
      kind: "behavioural" as const,
      updatedAt: item.updatedAt,
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    status:
      loadError || error
        ? ("error" as const)
        : selected && brief?.id !== selected
          ? ("loading" as const)
          : ("ready" as const),
    error: loadError || error,
    data: {
      brief: brief?.id === selected ? brief : null,
      entries,
      selection,
      explanations,
    },
    form: {
      values,
      setValues,
      optionSets: {
        briefKinds: [
          { value: "concept", label: "Concept" },
          { value: "system-design", label: "System design" },
        ],
      },
    },
    context: {
      busy,
      selected,
      topic: values.topic,
      explanations: explanations.length,
    },
    actions: {
      build,
      remove,
      new: () => studioActions.go("briefings"),
      explanations: () => studioActions.go("briefings", ["explanations"]),
      openBrief: studioActions.openBrief,
      openPack: studioActions.openBriefing,
      refresh: lists.refresh,
    },
  };
}
