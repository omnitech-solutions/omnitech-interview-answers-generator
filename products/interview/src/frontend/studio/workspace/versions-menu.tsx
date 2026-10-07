import { Button } from "@oc-tech/omni-ui-components";
import type { SavedAnswer } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { formatRelativeTime, formatTimestamp } from "../../format-timestamp";
import { Icon } from "../icon";

// Saved versions are immutable snapshots of the answer. Saving one is explicit;
// restoring one replaces the draft (which is itself saved as you type).
export function VersionsMenu({
  disabled,
  onSave,
  onList,
  onRestore,
}: {
  disabled: boolean;
  onSave(): Promise<void>;
  onList(): Promise<SavedAnswer[]>;
  onRestore(version: SavedAnswer): void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<SavedAnswer[] | null>(null);
  const [message, setMessage] = useState("");
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setVersions(null);
    onList().then(
      (items) => active && setVersions(items),
      () => active && setMessage("Couldn’t load versions."),
    );
    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      active = false;
      document.removeEventListener("mousedown", close);
    };
  }, [open, onList]);

  return (
    <div className="ws-versions" ref={menu}>
      <Button
        variant="outline"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setMessage("");
          setOpen(!open);
        }}
      >
        Versions
        <Icon name="expand_more" size={16} />
      </Button>
      {open && (
        <div className="ws-versions-menu" role="menu" aria-label="Versions">
          <button
            type="button"
            role="menuitem"
            className="ws-versions-save"
            disabled={disabled}
            onClick={() =>
              void onSave().then(
                async () => {
                  setMessage("Saved a version of this answer.");
                  setVersions(await onList());
                },
                (error: unknown) =>
                  setMessage(
                    error instanceof Error ? error.message : String(error),
                  ),
              )
            }
          >
            <Icon name="add" size={16} />
            Save this version
          </button>
          {message && (
            <div className="ws-versions-note" role="status">
              {message}
            </div>
          )}
          {versions === null ? (
            <div className="ws-versions-note">Loading…</div>
          ) : versions.length ? (
            versions.map((version) => (
              <button
                key={version.id}
                type="button"
                role="menuitem"
                className="ws-versions-item"
                title={`Restore — ${formatTimestamp(version.updatedAt)}`}
                onClick={() => {
                  if (
                    window.confirm(
                      "Replace the current draft with this saved version?",
                    )
                  ) {
                    onRestore(version);
                    setOpen(false);
                  }
                }}
              >
                <span>{version.title}</span>
                <span className="ws-faint">
                  {formatRelativeTime(version.updatedAt)}
                </span>
              </button>
            ))
          ) : (
            <div className="ws-versions-note">No saved versions yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
