// The coach's notes, under the footer: what to say next, read like a
// teleprompter, with the documentation for the topic. A coach outside this
// window (a person or an agent holding the API token) posts them; this strip
// only reads and shows them. It opens by itself when a new note arrives.
import { Button, Input, Tag } from "@oc-tech/omni-ui-components";
import {
  type CoachNote,
  coachNotesResponseSchema,
} from "@omnitech/interview-contracts";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

// A note matches when every word typed appears somewhere in it: its title,
// its text, or a link's label or address.
export function matchesNote(note: CoachNote, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [
    note.title,
    note.markdown ?? "",
    ...note.points,
    ...note.links.flatMap((link) => [link.label, link.url]),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

// What a note says, as Markdown: its own Markdown, or its points as bullets.
export const noteMarkdown = (note: CoachNote): string =>
  note.markdown ?? note.points.map((point) => `- ${point}`).join("\n");

// [STRATEGY] The strip's look is set here, not in the stylesheet: the native
// window takes a new component at once but keeps its old stylesheet until it
// reloads, and a prompter with no layout cannot be read at a glance.
// Sized to be read from a distance while talking: large type, loose lines,
// one idea per line, and the words to land in the accent colour.
const ACCENT = "var(--oui-accent, #7aa2ff)";
const MUTED = "var(--ov-muted, #9aa4b2)";
const STYLE = {
  strip: {
    flex: "0 0 auto",
    display: "flex",
    flexDirection: "column",
    padding: "6px 10px",
  },
  bar: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  body: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(200px, 280px)",
    gap: 14,
    height: 260,
    margin: "6px 0 4px",
  },
  prompter: {
    minHeight: 0,
    overflow: "auto",
    padding: "10px 16px 14px",
    borderRadius: 10,
    background: "var(--pn-chip, rgba(255,255,255,0.05))",
    fontSize: 18,
    lineHeight: 1.5,
  },
  head: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: 700, lineHeight: 1.25 },
  heading: {
    margin: "12px 0 4px",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: MUTED,
  },
  list: { margin: "4px 0", paddingLeft: 22 },
  item: { margin: "6px 0" },
  paragraph: { margin: "6px 0" },
  strong: { color: ACCENT, fontWeight: 700 },
  code: {
    padding: "1px 5px",
    borderRadius: 5,
    background: "rgba(127,127,127,0.22)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.88em",
  },
  pre: {
    margin: "8px 0",
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(127,127,127,0.18)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.45,
    overflow: "auto",
    whiteSpace: "pre",
  },
  figure: { margin: "8px 0", overflow: "auto", textAlign: "center" },
  links: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 },
  side: { display: "flex", flexDirection: "column", gap: 6, minHeight: 0 },
  sideHead: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: MUTED,
  },
  history: {
    flex: "1 1 auto",
    minHeight: 0,
    margin: 0,
    padding: 0,
    overflow: "auto",
    listStyle: "none",
  },
  empty: { color: MUTED, fontSize: 14 },
} satisfies Record<string, CSSProperties>;

// Bold and inline code inside one line of a note.
function inlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(/\*\*([^*]+)\*\*|`([^`]+)`/g)) {
    if (match.index > from) parts.push(text.slice(from, match.index));
    parts.push(
      match[1] !== undefined ? (
        <strong key={match.index} style={STYLE.strong}>
          {match[1]}
        </strong>
      ) : (
        <code key={match.index} style={STYLE.code}>
          {match[2]}
        </code>
      ),
    );
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

type Block =
  | { kind: "code"; language: string; source: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "text"; text: string };

// [DOMAIN] The Markdown a coach's note uses, and no more: headings, bullets,
// numbered steps, paragraphs, bold and inline code, and fenced blocks. A
// fenced block marked "mermaid" is drawn as a diagram (a flow, a sequence, an
// architecture sketch); any other is shown as code. Anything else is shown as
// the text it is; nothing a note says is ever rendered as HTML.
export function noteBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let fence: { language: string; lines: string[] } | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const mark = /^\s*```\s*([\w-]*)\s*$/.exec(raw);
    if (fence) {
      if (mark) {
        blocks.push({
          kind: "code",
          language: fence.language,
          source: fence.lines.join("\n"),
        });
        fence = null;
      } else fence.lines.push(raw);
      continue;
    }
    if (mark) {
      fence = { language: (mark[1] ?? "").toLowerCase(), lines: [] };
      continue;
    }
    const line = raw.trim();
    if (line === "") continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const step = /^\d+[.)]\s+(.+)$/.exec(line);
    const last = blocks.at(-1);
    if (heading) blocks.push({ kind: "heading", text: heading[1] as string });
    else if (bullet || step) {
      const ordered = Boolean(step);
      const text = (bullet?.[1] ?? step?.[1]) as string;
      if (last?.kind === "list" && last.ordered === ordered)
        last.items.push(text);
      else blocks.push({ kind: "list", ordered, items: [text] });
    } else blocks.push({ kind: "text", text: line });
  }
  // A fence left open (a note cut short) still shows what it holds.
  if (fence && fence.lines.length > 0)
    blocks.push({
      kind: "code",
      language: fence.language,
      source: fence.lines.join("\n"),
    });
  return blocks;
}

// [SAFETY] The diagram is drawn by Mermaid at its strict security level, which
// escapes the text in the source and allows no script or link in the result;
// that drawing is the only markup a note ever puts on the page. Mermaid is
// loaded only when a note carries a diagram.
function Diagram({ source }: { source: string }) {
  const id = `pn-coach-diagram-${useId().replaceAll(":", "")}`;
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        const root = document.querySelector<HTMLElement>(".pn-root");
        const light =
          (root?.dataset["theme"] ??
            document.documentElement.dataset["theme"]) === "light";
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: light ? "default" : "dark",
          flowchart: { useMaxWidth: true, htmlLabels: false },
        });
        const drawn = await mermaid.render(id, source);
        // Mermaid pins the drawing to its natural width; here it is scaled
        // to the prompter instead, so a wide flow is seen whole.
        if (live)
          setSvg(
            drawn.svg.replace(
              /style="max-width:[^"]*"/,
              'style="max-width:100%;height:auto;max-height:210px"',
            ),
          );
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [id, source]);
  // A diagram that cannot be drawn shows its source, so nothing is lost.
  if (failed)
    return (
      <pre style={STYLE.pre} data-testid="pn-coach-diagram-source">
        {source}
      </pre>
    );
  return (
    <figure
      style={STYLE.figure}
      role="img"
      aria-label="Diagram"
      data-testid="pn-coach-diagram"
      // Mermaid's own drawing at its strict security level (escaped text, no
      // script, no link): never the note's text.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function Prompter({ note }: { note: CoachNote }) {
  const blocks = noteBlocks(noteMarkdown(note));
  return (
    <article
      style={STYLE.prompter}
      data-tone={note.tone}
      data-text-surface=""
      data-testid="pn-coach-note"
    >
      <header style={STYLE.head}>
        <Tag>{note.tone === "watch" ? "Watch" : "Say"}</Tag>
        <strong style={STYLE.title}>{note.title}</strong>
      </header>
      {blocks.map((block, at) => {
        const key = `${at}:${block.kind}`;
        if (block.kind === "code")
          return block.language === "mermaid" ? (
            <Diagram key={key} source={block.source} />
          ) : (
            <pre key={key} style={STYLE.pre}>
              {block.source}
            </pre>
          );
        if (block.kind === "heading")
          return (
            <h4 key={key} style={STYLE.heading}>
              {inlineMarkdown(block.text)}
            </h4>
          );
        if (block.kind === "text")
          return (
            <p key={key} style={STYLE.paragraph}>
              {inlineMarkdown(block.text)}
            </p>
          );
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={key} style={STYLE.list}>
            {block.items.map((item) => (
              <li key={item} style={STYLE.item}>
                {inlineMarkdown(item)}
              </li>
            ))}
          </List>
        );
      })}
      {note.links.length > 0 && (
        <div style={STYLE.links}>
          {note.links.map((link) => (
            <Button
              key={link.url}
              buttonSize="sm"
              variant="outline"
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
    </article>
  );
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// The gap the window's rows keep between them (panels.css): a strip that
// appears adds its own height and one gap.
const ROW_GAP = 8;
const MAX_STRIP_HEIGHT = 340;

export function CoachNotes({
  enabled,
  setWindowSize,
}: {
  enabled: boolean;
  // The shell's window size, when this page is hosted natively.
  setWindowSize?:
    | ((size: { width: number; height?: number }) => unknown)
    | undefined;
}) {
  const { notes, clear } = useCoachNotes(enabled);
  // [DOMAIN] The strip never takes room from the panes above it: the window
  // grows by the strip's height when it appears or opens, and gives that
  // height back when it folds or goes. The panes keep the height they had.
  const strip = useRef<HTMLElement | null>(null);
  const added = useRef(0);
  const resize = useRef(setWindowSize);
  resize.current = setWindowSize;
  const follow = (height: number) => {
    // Bounded, so nothing can make the window chase its own height.
    const wanted =
      height > 0 ? Math.min(Math.ceil(height), MAX_STRIP_HEIGHT) + ROW_GAP : 0;
    const change = wanted - added.current;
    if (change === 0 || !resize.current) return;
    added.current = wanted;
    void resize.current({
      width: window.innerWidth,
      height: Math.max(window.innerHeight + change, 200),
    });
  };
  const attach = (element: HTMLElement | null) => {
    strip.current = element;
  };
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) {
      follow(0);
      return;
    }
    follow(element.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => follow(element.offsetHeight));
    watch.observe(element);
    return () => watch.disconnect();
  });
  // Leaving (the session ended, the window closed its panes) gives it back.
  useEffect(() => () => follow(0), []);
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
  const shown = found.find((note) => note.id === picked) ?? found[0];
  return (
    <section
      ref={attach}
      // Its own height only, never a share of the window's: a strip that
      // stretched with the window would ask for a taller window again.
      style={STYLE.strip}
      className="pn-card pn-coach"
      aria-label="Coach notes"
      data-testid="pn-coach"
    >
      <div style={STYLE.bar}>
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
        <div style={STYLE.body}>
          {shown ? (
            // Keyed by note, so a new note starts at its top.
            <Prompter key={shown.id} note={shown} />
          ) : (
            <p style={STYLE.empty} role="status">
              No note matches “{query}”.
            </p>
          )}
          {/* Search, then the history it narrows, newest first. Picking an
              entry puts that note on the prompter. */}
          <nav style={STYLE.side} aria-label="Note history">
            <Input
              variant="panel"
              aria-label="Search coach notes"
              placeholder="Search notes"
              value={query}
              onChange={setQuery}
              data-testid="pn-coach-search"
            />
            <div style={STYLE.sideHead}>
              {query.trim()
                ? `${found.length} of ${notes.length}`
                : `History · ${notes.length}`}
            </div>
            <ul style={STYLE.history}>
              {found.map((note) => (
                <li key={note.id}>
                  <Button
                    buttonSize="sm"
                    variant={note.id === shown?.id ? "secondary" : "ghost"}
                    aria-current={note.id === shown?.id ? "true" : undefined}
                    title={note.title}
                    labelMaxWidth="210px"
                    onClick={() => setPicked(note.id)}
                    data-testid="pn-coach-history-item"
                  >
                    {`${timeOf(note.createdAt)} · ${note.tone === "watch" ? "⚠ " : ""}${note.title}`}
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
