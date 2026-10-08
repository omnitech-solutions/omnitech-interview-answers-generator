// The coach's notes, under the footer: what to mention next and where the
// documentation for the topic is. A coach outside this window (a person or an
// agent holding the API token) posts them; this strip only reads and shows
// them. It opens by itself when a new note arrives and can be folded away.
import { Button, Tag } from "@oc-tech/omni-ui-components";
import {
  type CoachNote,
  coachNotesResponseSchema,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../icon";
import { TENANT_HEADER } from "../../../studio-fetch";
import { openExternalThroughHost } from "../../host-adapter";
import { windowTenant } from "./use-account";

const POLL_MS = 2_000;
const ENDPOINT = "/api/v1/coach-notes";

const request = (method: "GET" | "DELETE") =>
  fetch(ENDPOINT, { method, headers: { [TENANT_HEADER]: windowTenant() } });

// The notes as the server holds them, read on a short interval while the
// session is open. A failed read keeps what is on show.
export function useCoachNotes(enabled: boolean): {
  notes: readonly CoachNote[];
  clear(): void;
} {
  const [notes, setNotes] = useState<readonly CoachNote[]>([]);
  const revision = useRef(-1);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const read = async () => {
      try {
        const response = await request("GET");
        if (!response.ok) return;
        const body = coachNotesResponseSchema.parse(await response.json());
        if (!live || body.revision === revision.current) return;
        revision.current = body.revision;
        setNotes(body.notes);
      } catch {
        // Offline or mid-reload: the next read tries again.
      }
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return {
    notes,
    clear: () => {
      setNotes([]);
      void request("DELETE").catch(() => undefined);
    },
  };
}

function openLink(url: string): void {
  if (!openExternalThroughHost(url))
    window.open(url, "_blank", "noopener,noreferrer");
}

function Note({ note, latest }: { note: CoachNote; latest: boolean }) {
  return (
    <li
      className="pn-coach-note"
      data-tone={note.tone}
      data-latest={latest ? "" : undefined}
      data-testid="pn-coach-note"
    >
      <div className="pn-coach-note-head">
        <Tag>{note.tone === "watch" ? "Watch" : "Say"}</Tag>
        <strong>{note.title}</strong>
      </div>
      {note.points.length > 0 && (
        <ul className="pn-coach-points">
          {note.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      {note.links.length > 0 && (
        <div className="pn-coach-links">
          {note.links.map((link) => (
            <Button
              key={link.url}
              buttonSize="sm"
              variant="ghost"
              icon={<Icon name="open_in_new" />}
              title={link.url}
              onClick={() => openLink(link.url)}
              data-testid="pn-coach-link"
            >
              {link.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

export function CoachNotes({ enabled }: { enabled: boolean }) {
  const { notes, clear } = useCoachNotes(enabled);
  const [open, setOpen] = useState(false);
  // The newest note the person has seen: a newer one opens the strip and is
  // counted as new until the strip has been open on it.
  const seen = useRef<string | null>(null);
  const newest = notes[0]?.id ?? null;
  useEffect(() => {
    if (newest === null || newest === seen.current) return;
    seen.current = newest;
    setOpen(true);
  }, [newest]);
  if (!enabled || notes.length === 0) return null;
  const [first, ...earlier] = notes;
  return (
    <section
      className="pn-card pn-coach"
      aria-label="Coach notes"
      data-testid="pn-coach"
    >
      <div className="pn-coach-bar">
        <Button
          buttonSize="sm"
          variant="ghost"
          icon={<Icon name={open ? "expand_more" : "chevron_right"} />}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid="pn-coach-toggle"
        >
          {`Coach · ${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
        </Button>
        {!open && first && (
          <span className="pn-coach-preview">{first.title}</span>
        )}
        <Button
          buttonSize="sm"
          variant="ghost"
          onClick={clear}
          data-testid="pn-coach-clear"
        >
          Clear
        </Button>
      </div>
      {open && first && (
        <ul className="pn-coach-list" data-text-surface="">
          <Note note={first} latest />
          {earlier.map((note) => (
            <Note key={note.id} note={note} latest={false} />
          ))}
        </ul>
      )}
    </section>
  );
}
