import { createBriefsClient } from "@omnitech/interview-api-client";
import type { Brief } from "@omnitech/interview-contracts";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatRelativeTime } from "../../format-timestamp";
import { InterviewPreparation } from "../../interview-preparation";
import type { StudioActions } from "../config/commands";
import { useStudio } from "../context";
import { Icon } from "../icon";
import type { StudioLists } from "../use-studio-lists";
import { BriefCard } from "./brief-card";
import { NewBrief } from "./new-brief";

const KIND_LABELS = {
  concept: "Concept",
  "system-design": "System design",
} as const;
const GENERATION_FAILED =
  "The briefing couldn’t be built. Check the model is running, then try again.";

// What the right-hand side shows, from the path after /briefings.
type Selection =
  | { kind: "new" }
  | { kind: "brief"; id: string }
  | { kind: "pack"; id: string };
export function selectionOf(rest: readonly string[]): Selection {
  if (rest[0] === "brief" && rest[1]) return { kind: "brief", id: rest[1] };
  if (rest[0]) return { kind: "pack", id: rest[0] };
  return { kind: "new" };
}

// Briefings: every spoken answer being prepared, and the one open.
export function BriefingsView({
  rest,
  actions,
  lists,
  onDirtyChange,
}: {
  rest: readonly string[];
  actions: StudioActions;
  lists: StudioLists;
  onDirtyChange(dirty: boolean): void;
}) {
  const studio = useStudio();
  const client = useMemo(() => createBriefsClient({ baseUrl: "" }), []);
  const selection = selectionOf(rest);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState("");
  const selectedBrief = selection.kind === "brief" ? selection.id : null;

  useEffect(() => {
    if (!selectedBrief) return;
    let active = true;
    setBrief(null);
    setLoadError("");
    client.get(selectedBrief).then(
      (loaded) => active && setBrief(loaded),
      () => active && setLoadError("This brief couldn’t be loaded."),
    );
    return () => {
      active = false;
    };
  }, [client, selectedBrief]);

  const entries = [
    ...lists.briefs.map((item) => ({
      key: `brief:${item.id}`,
      title: item.title,
      kind: KIND_LABELS[item.kind],
      updatedAt: item.updatedAt,
      selected: selection.kind === "brief" && selection.id === item.id,
      open: () => actions.openBrief(item.id),
    })),
    ...lists.briefings.map((item) => ({
      key: `pack:${item.id}`,
      title: item.title,
      kind: "Behavioural · STAR",
      updatedAt: item.updatedAt,
      selected: selection.kind === "pack" && selection.id === item.id,
      open: () => actions.openBriefing(item.id),
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const title =
    selection.kind === "brief"
      ? (brief?.title ?? "")
      : selection.kind === "pack"
        ? (lists.briefings.find((item) => item.id === selection.id)?.title ??
          "Interview preparation")
        : "New briefing";

  return (
    <div className="briefings">
      {studio?.headerSlot &&
        createPortal(
          <span className="ws-title">{title}</span>,
          studio.headerSlot,
        )}
      <aside className="briefings-list" aria-label="Briefings">
        <div className="briefings-list-head">
          <span>Briefings</span>
          <button
            type="button"
            className="studio-icon-button"
            aria-label="New briefing"
            title="New briefing"
            onClick={() => actions.go("briefings")}
          >
            <Icon name="add" />
          </button>
        </div>
        <div className="briefings-items">
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="briefings-item"
              aria-current={entry.selected ? "page" : undefined}
              onClick={entry.open}
            >
              <span className="briefings-item-title">{entry.title}</span>
              <span className="briefings-item-meta">
                {entry.kind} · {formatRelativeTime(entry.updatedAt)}
              </span>
            </button>
          ))}
          {lists.status === "ready" && !entries.length && (
            <p className="briefings-empty">Your briefings will appear here.</p>
          )}
        </div>
      </aside>
      <div className="briefings-main">
        {selection.kind === "new" && (
          <NewBrief
            busy={busy}
            error={buildError}
            onBuild={(kind, topic) => {
              setBusy(true);
              setBuildError("");
              client
                .build({ kind, topic })
                .then((built) => {
                  lists.refresh();
                  actions.openBrief(built.id);
                })
                .catch(() => setBuildError(GENERATION_FAILED))
                .finally(() => setBusy(false));
            }}
            onBehavioural={() =>
              actions.openBriefing(`prep-${Date.now().toString(36)}`)
            }
          />
        )}
        {selection.kind === "brief" &&
          (brief ? (
            <BriefCard
              brief={brief}
              onDelete={() =>
                void client.remove(brief.id).then(() => {
                  lists.refresh();
                  actions.go("briefings");
                })
              }
            />
          ) : (
            <p className="ws-loading" role={loadError ? "alert" : "status"}>
              {loadError || "Loading brief…"}
            </p>
          ))}
        {selection.kind === "pack" && (
          <InterviewPreparation
            key={selection.id}
            artifactId={selection.id}
            onDirtyChange={onDirtyChange}
          />
        )}
      </div>
    </div>
  );
}
