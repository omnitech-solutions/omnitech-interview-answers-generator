import { Icon, useAssistantHost } from "@omnitech-assistant/react";
import type { ProposalRecord } from "@omnitech-assistant/sdk";
import { diffLines } from "diff";

export type EditorFile = "solution" | "usage" | "tests";

// The proposal surface each code tab shows.
const FILE_SURFACE: Record<EditorFile, string> = {
  solution: "code",
  usage: "usageCode",
  tests: "testCode",
};
export function previewedChange(
  record: ProposalRecord | null,
  file: EditorFile,
) {
  return record?.changes?.find((change) => change.id === FILE_SURFACE[file]);
}

// While a proposed change is previewed, the code panel shows the new version
// with added and removed lines marked. Nothing is applied.
export function PreviewedCode({
  change,
}: {
  change: NonNullable<ReturnType<typeof previewedChange>>;
}) {
  const rows = diffLines(change.before, change.after).flatMap((part) =>
    part.value
      .replace(/\n$/, "")
      .split("\n")
      .map((text) => ({
        text,
        kind: part.added ? "added" : part.removed ? "removed" : "same",
      })),
  );
  let line = 0;
  return (
    <div className="assistant-preview-code" aria-label="Previewed change">
      {rows.map((row, index) => (
        <div key={index} className={`assistant-preview-line ${row.kind}`}>
          <span className="assistant-preview-number">
            {row.kind === "removed" ? "" : ++line}
          </span>
          <span>{row.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

// Above the code: a change being previewed, or the one just applied.
export function AssistantChangeBanner() {
  const host = useAssistantHost();
  if (host.preview)
    return (
      <div className="assistant-change-banner preview" role="status">
        <Icon name="visibility" />
        <span>Previewing assistant change — not applied</span>
        <button type="button" onClick={host.discardPreview}>
          Discard
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void host.applyPreview()}
        >
          Apply
        </button>
      </div>
    );
  if (host.applied) {
    const count = host.applied.changes?.length ?? 0;
    return (
      <div className="assistant-change-banner applied" role="status">
        <Icon name="check_circle" />
        <span>
          Updated by assistant
          {count ? ` · ${count} surface${count === 1 ? "" : "s"} changed` : ""}
        </span>
        <button type="button" onClick={() => void host.undoApplied()}>
          Undo
        </button>
      </div>
    );
  }
  return null;
}
