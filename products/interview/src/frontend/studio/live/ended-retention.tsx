// The retention row of a finished session: what the mode means, shortening it,
// and "Delete session data" with its confirm step (ADR-0012/retention-modes,
// owner-chooses-retention, complete-session-purge). Browser-visible failures
// are fixed codes: this file maps them to sentences and shows nothing else.

import { Button } from "@oc-tech/omni-ui-components";
import type {
  LiveRetentionMode,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
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
  // Closing the confirm step (Keep session data, or after the delete ran)
  // returns focus to the button that opened it, when that button is still here.
  const deleteButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirming) deleteButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
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
                <Button
                  variant="outline"
                  buttonSize="lg"
                  key={mode}
                  disabled={!shorter.includes(mode)}
                  pressed={mode === session.retention}
                  onClick={() => void choose(mode)}
                >
                  {RETENTION_LABEL[mode]}
                </Button>
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
                <Button
                  variant="destructive"
                  buttonSize="lg"
                  className="ended-danger"
                  onClick={() => void confirmDelete()}
                >
                  <Icon name="delete" />
                  Delete permanently
                </Button>
                <Button
                  variant="outline"
                  buttonSize="lg"
                  onClick={() => setConfirming(false)}
                >
                  Keep session data
                </Button>
              </div>
            </div>
          ) : (
            <div className="ended-actions">
              <Button
                variant="destructive"
                buttonSize="lg"
                ref={deleteButton}
                className="ended-danger"
                onClick={() => {
                  setDeleteError(null);
                  setConfirming(true);
                }}
              >
                <Icon name="delete" />
                Delete session data
              </Button>
            </div>
          )}
          {deleteError && (
            <p className="ended-error" role="alert">
              {deleteError}{" "}
              {!confirming && !purging && (
                <Button
                  variant="outline"
                  buttonSize="lg"
                  onClick={() => void confirmDelete()}
                >
                  <Icon name="refresh" />
                  Retry deletion
                </Button>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
