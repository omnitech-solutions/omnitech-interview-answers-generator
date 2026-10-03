// The retention row of a finished session: what the mode means, shortening it,
// and "Delete session data" with its confirm step (ADR-0012/retention-modes,
// owner-chooses-retention, complete-session-purge). Browser-visible failures
// are fixed codes: this file maps them to sentences and shows nothing else.
import type {
  LiveRetentionMode,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { useState } from "react";
import { Icon } from "../icon";
import {
  PROMOTED_NOTE,
  RETENTION_LABEL,
  RETENTION_MODES,
  retentionMeaning,
  shorterRetentions,
} from "./ended-summary";
import type { SessionErrorCode } from "./session-client";
import type { CommandResult } from "./session-snapshot";

const SHORTEN_ERROR: Partial<Record<SessionErrorCode, string>> = {
  retention_lengthening_refused: "Retention can only be shortened.",
};
const DELETE_ERROR: Partial<Record<SessionErrorCode, string>> = {
  purge_incomplete:
    "Deletion did not finish, so nothing was removed. Nothing more is being added to the session. Try again.",
};

export type EndedRetentionProps = {
  session: LiveSessionView;
  // A delete command is in flight.
  deleting: boolean;
  shorten(retention: LiveRetentionMode): Promise<CommandResult>;
  remove(): Promise<CommandResult>;
};

export function EndedRetention({
  session,
  deleting,
  shorten,
  remove,
}: EndedRetentionProps) {
  const [confirming, setConfirming] = useState(false);
  const [shortenError, setShortenError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const shorter = shorterRetentions(session.retention);
  const purging = session.status === "purging" || deleting;

  async function confirmDelete() {
    setDeleteError(null);
    const result = await remove();
    setConfirming(false);
    if (!result.ok)
      setDeleteError(
        DELETE_ERROR[result.code] ??
          "Studio couldn’t delete the session data. Try again.",
      );
  }
  async function choose(retention: LiveRetentionMode) {
    setShortenError(null);
    const result = await shorten(retention);
    if (!result.ok)
      setShortenError(
        SHORTEN_ERROR[result.code] ??
          "Studio couldn’t change retention. Try again.",
      );
  }

  return (
    <section
      className="ended-retention"
      aria-labelledby="ended-retention-title"
      data-testid="ended-retention"
    >
      <h3 id="ended-retention-title" className="ended-heading">
        Retention
      </h3>
      {session.purged ? (
        <p className="ended-purged-line" role="status">
          <Icon name="check_circle" />
          Deleted
        </p>
      ) : (
        <>
          <p className="ended-retention-mode">
            <strong>{RETENTION_LABEL[session.retention]}</strong>
            {" · "}
            {retentionMeaning(session)}
          </p>
          <p className="live-note">{PROMOTED_NOTE}</p>
          {shorter.length > 0 && !purging && (
            <div
              className="ended-shorten"
              role="group"
              aria-label="Shorten retention"
            >
              <span className="live-note">Shorten to</span>
              {RETENTION_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="studio-button"
                  disabled={!shorter.includes(mode)}
                  aria-pressed={mode === session.retention}
                  onClick={() => void choose(mode)}
                >
                  {RETENTION_LABEL[mode]}
                </button>
              ))}
            </div>
          )}
          {shortenError && (
            <p className="ended-error" role="alert">
              {shortenError}
            </p>
          )}
          {purging ? (
            <p className="ended-purge-progress" role="status" aria-busy="true">
              <Icon name="pending" />
              Deleting…
            </p>
          ) : confirming ? (
            <div
              className="ended-confirm"
              role="group"
              aria-label="Confirm deleting session data"
            >
              <p>
                Delete this session’s transcript, screenshots, answer drafts and
                unedited, unreferenced session Workspace drafts? This can’t be
                undone. Edited drafts and drafts used by an answer revision or
                revert can remain in Workspace. They may contain captured
                questions and generated answers or code. Delete them separately
                in Workspace. Copies in backups remain until they rotate.
              </p>
              <div className="ended-actions">
                <button
                  type="button"
                  className="studio-button ended-danger"
                  onClick={() => void confirmDelete()}
                >
                  <Icon name="delete" />
                  Delete permanently
                </button>
                <button
                  type="button"
                  className="studio-button"
                  onClick={() => setConfirming(false)}
                >
                  Keep session data
                </button>
              </div>
            </div>
          ) : (
            <div className="ended-actions">
              <button
                type="button"
                className="studio-button ended-danger"
                onClick={() => {
                  setDeleteError(null);
                  setConfirming(true);
                }}
              >
                <Icon name="delete" />
                Delete session data
              </button>
            </div>
          )}
          {deleteError && (
            <p className="ended-error" role="alert">
              {deleteError}{" "}
              {!confirming && !purging && (
                <button
                  type="button"
                  className="studio-button"
                  onClick={() => void confirmDelete()}
                >
                  <Icon name="refresh" />
                  Retry deletion
                </button>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
