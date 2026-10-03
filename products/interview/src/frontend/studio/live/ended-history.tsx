// Session history: a compact list of past sessions (summaries only: no
// transcript, draft or answer content ever comes from the list route), newest
// first, paged by the server's cursor. Opening one addresses it as live/<id>.
import type { LiveSessionSummary } from "@omnitech/interview-contracts";
import { useMemo, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon } from "../icon";
import { formatDayTime, RETENTION_LABEL } from "./ended-summary";
import { createSessionClient } from "./session-client";
import { tenantFromLocation } from "./session-registry";

const PAGE = 10;

function targetOf(session: LiveSessionSummary): string {
  if (session.rehearsal) return "Rehearsal";
  if (session.interviewId) return "Interview";
  if (session.candidacyId) return "Candidacy";
  return "No interview linked";
}
function statusOf(session: LiveSessionSummary): string {
  if (session.purged) return "Deleted";
  if (session.status === "purging") return "Deleting";
  if (session.status === "ended") return "Ended";
  if (session.status === "paused") return "Paused";
  return "Open";
}

export function SessionHistory({ studio }: { studio: StudioActions }) {
  const client = useMemo(() => createSessionClient(tenantFromLocation()), []);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<LiveSessionSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load(cursor?: string) {
    setLoading(true);
    setFailed(false);
    try {
      const page = await client.list({
        limit: PAGE,
        ...(cursor ? { cursor } : {}),
      });
      setSessions((held) => [...held, ...page.sessions]);
      setNext(page.nextCursor);
      setLoaded(true);
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }

  return (
    <section className="ended-history" aria-label="Session history">
      <button
        type="button"
        className="studio-button"
        aria-expanded={open}
        aria-controls="ended-history-list"
        onClick={() => {
          const opening = !open;
          setOpen(opening);
          if (opening && !loaded && !loading) void load();
        }}
      >
        <Icon name="history" />
        {open ? "Hide session history" : "Open session history"}
      </button>
      {open && (
        <div id="ended-history-list" data-testid="session-history">
          {loaded && sessions.length === 0 && (
            <p className="live-note">No past sessions yet.</p>
          )}
          {sessions.length > 0 && (
            <ul className="ended-history-list">
              {sessions.map((session) => (
                <li key={session.id} className="ended-history-row">
                  <div className="ended-history-main">
                    <span className="ended-history-target">
                      {targetOf(session)}
                    </span>
                    <span className="live-note">
                      {formatDayTime(session.createdAt)}
                    </span>
                  </div>
                  <span className="live-chip neutral">{statusOf(session)}</span>
                  <span className="live-chip neutral">
                    {RETENTION_LABEL[session.retention]}
                  </span>
                  <button
                    type="button"
                    className="studio-button"
                    aria-label={`Open ${targetOf(session)} session from ${formatDayTime(session.createdAt)}`}
                    onClick={() => studio.go("live", [session.id])}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
          {failed && (
            <p className="ended-error" role="alert">
              Studio couldn’t load your sessions.{" "}
              <button
                type="button"
                className="studio-button"
                onClick={() => void load(next ?? undefined)}
              >
                Try again
              </button>
            </p>
          )}
          {next && !failed && (
            <button
              type="button"
              className="studio-button"
              disabled={loading}
              onClick={() => void load(next)}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
