// The coach's notes, under the footer: what to mention next and where the
// documentation for the topic is. A coach outside this window (a person or an
// agent holding the API token) posts them; this strip only reads and shows
// them. It opens by itself when a new note arrives and can be folded away.
import { Button, Input, Tag } from "@oc-tech/omni-ui-components";
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

// A note matches when every word typed appears somewhere in it: its title,
// its points, or a link's label or address.
export function matchesNote(note: CoachNote, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [
    note.title,
    ...note.points,
    ...note.links.flatMap((link) => [link.label, link.url]),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

// [STRATEGY] The strip's structure is set here, not only in the stylesheet:
// the native window takes a new component at once but keeps its old
// stylesheet until it reloads, and a strip with no layout is unreadable.
const BAR = { display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
const BODY = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(180px, 280px)",
  gap: 10,
  maxHeight: 220,
  margin: "6px 0 2px",
};
const PLAIN_LIST = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  minHeight: 0,
  overflow: "auto",
};
const HISTORY = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  paddingLeft: 10,
} as const;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function CoachNotes({ enabled }: { enabled: boolean }) {
  const { notes, clear } = useCoachNotes(enabled);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The note on show: the one picked from the history, or the newest.
  const [picked, setPicked] = useState<string | null>(null);
  // The newest note the person has seen: a newer one opens the strip and
  // takes the place of whatever was picked.
  const seen = useRef<string | null>(null);
  const newest = notes[0]?.id ?? null;
  useEffect(() => {
    if (newest === null || newest === seen.current) return;
    seen.current = newest;
    setPicked(null);
    setOpen(true);
  }, [newest]);
  if (!enabled || notes.length === 0) return null;
  const found = notes.filter((note) => matchesNote(note, query));
  const shown =
    found.find((note) => note.id === picked) ?? found[0] ?? undefined;
  return (
    <section
      className="pn-card pn-coach"
      aria-label="Coach notes"
      data-testid="pn-coach"
    >
      <div className="pn-coach-bar" style={BAR}>
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
        {!open && notes[0] && (
          <span className="pn-coach-preview">{notes[0].title}</span>
        )}
        {open && (
          <div
            className="pn-coach-search"
            style={{ flex: "0 1 260px", minWidth: 120 }}
          >
            <Input
              variant="panel"
              aria-label="Search coach notes"
              placeholder="Search notes"
              value={query}
              onChange={setQuery}
              data-testid="pn-coach-search"
            />
          </div>
        )}
        <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
        <Button
          buttonSize="sm"
          variant="ghost"
          onClick={() => {
            setQuery("");
            clear();
          }}
          data-testid="pn-coach-clear"
        >
          Clear
        </Button>
      </div>
      {open && (
        <div className="pn-coach-body" style={BODY}>
          <ul className="pn-coach-list" data-text-surface="" style={PLAIN_LIST}>
            {shown ? (
              <Note note={shown} latest />
            ) : (
              <li className="pn-coach-empty" role="status">
                No note matches “{query}”.
              </li>
            )}
          </ul>
          {/* The history, newest first: every note that matches the search.
              Picking one shows it on the left. */}
          <nav
            className="pn-coach-history"
            aria-label="Note history"
            style={HISTORY}
          >
            <div className="pn-coach-history-head">
              {query.trim()
                ? `${found.length} of ${notes.length}`
                : `History · ${notes.length}`}
            </div>
            <ul style={PLAIN_LIST}>
              {found.map((note) => (
                <li key={note.id}>
                  <Button
                    buttonSize="sm"
                    variant="ghost"
                    className="pn-coach-history-item"
                    aria-current={note.id === shown?.id ? "true" : undefined}
                    data-tone={note.tone}
                    title={note.title}
                    onClick={() => setPicked(note.id)}
                    data-testid="pn-coach-history-item"
                  >
                    {`${timeOf(note.createdAt)} · ${note.title}`}
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </section>
  );
}
