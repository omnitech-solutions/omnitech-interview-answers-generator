// The coach panel: which notes a search finds, how a note's Markdown is read,
// where a dragged panel snaps, and that the panel stands down in a coach view
// (the coach layout draws the notes itself, under their questions).
import type { CoachNote } from "@omnitech/interview-contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoachNotes,
  matchesNote,
  nearestDock,
  noteBlocks,
  noteMarkdown,
} from "./coach-notes";

const note = (extra: Partial<CoachNote> = {}): CoachNote => ({
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-08T17:40:00.000Z",
  title: "Data consistency",
  tone: "say",
  points: ["Name the Outbox pattern", "Mention idempotent consumers"],
  links: [{ label: "Saga reference", url: "https://example.com/patterns" }],
  ...extra,
});

describe("matchesNote", () => {
  it("matches every note for an empty or blank search", () => {
    expect(matchesNote(note(), "")).toBe(true);
    expect(matchesNote(note(), "   ")).toBe(true);
  });

  it("finds a word in the title, a point, a link's label or its address, whatever the case", () => {
    expect(matchesNote(note(), "CONSISTENCY")).toBe(true);
    expect(matchesNote(note(), "outbox")).toBe(true);
    expect(matchesNote(note(), "saga")).toBe(true);
    expect(matchesNote(note(), "example.com")).toBe(true);
  });

  it("finds a word in the note's Markdown", () => {
    expect(
      matchesNote(
        note({ markdown: "Say **eventual** consistency" }),
        "eventual",
      ),
    ).toBe(true);
  });

  it("needs every word typed, in any order and from any part of the note", () => {
    expect(matchesNote(note(), "saga outbox data")).toBe(true);
    expect(matchesNote(note(), "outbox kubernetes")).toBe(false);
  });
});

describe("noteMarkdown", () => {
  it("is the note's own Markdown, or its points as bullets", () => {
    expect(noteMarkdown(note({ markdown: "## Say\nthis" }))).toBe(
      "## Say\nthis",
    );
    expect(noteMarkdown(note())).toBe(
      "- Name the Outbox pattern\n- Mention idempotent consumers",
    );
  });
});

describe("noteBlocks", () => {
  it("reads headings of any level as headings", () => {
    expect(noteBlocks("# Opening\n\n### Then")).toEqual([
      { kind: "heading", text: "Opening" },
      { kind: "heading", text: "Then" },
    ]);
  });

  it("gathers neighbouring bullets into one list, whichever mark they use", () => {
    expect(noteBlocks("- one\n* two\n• three")).toEqual([
      { kind: "list", ordered: false, items: ["one", "two", "three"] },
    ]);
  });

  it("keeps numbered steps apart from bullets", () => {
    expect(noteBlocks("1. first\n2) second\n- aside")).toEqual([
      { kind: "list", ordered: true, items: ["first", "second"] },
      { kind: "list", ordered: false, items: ["aside"] },
    ]);
  });

  it("starts a new list after a paragraph, and drops blank lines", () => {
    expect(noteBlocks("- one\n\nA sentence.\n\n- two")).toEqual([
      { kind: "list", ordered: false, items: ["one"] },
      { kind: "text", text: "A sentence." },
      { kind: "list", ordered: false, items: ["two"] },
    ]);
  });

  it("keeps a fenced block as code, exactly as written", () => {
    expect(
      noteBlocks(
        "Before\n```TS\nconst a = 1;\n\n  # not a heading\n- not a list\n```\nAfter",
      ),
    ).toEqual([
      { kind: "text", text: "Before" },
      {
        kind: "code",
        language: "ts",
        source: "const a = 1;\n\n  # not a heading\n- not a list",
      },
      { kind: "text", text: "After" },
    ]);
  });

  it("marks a mermaid fence, so it is drawn as a diagram", () => {
    expect(noteBlocks("```mermaid\nflowchart LR\n  A --> B\n```")).toEqual([
      { kind: "code", language: "mermaid", source: "flowchart LR\n  A --> B" },
    ]);
  });

  it("a fence with no language is code with none", () => {
    expect(noteBlocks("```\nplain\n```")).toEqual([
      { kind: "code", language: "", source: "plain" },
    ]);
  });

  it("still shows a fence that was never closed, and nothing for an empty one", () => {
    expect(noteBlocks("```sql\nselect 1")).toEqual([
      { kind: "code", language: "sql", source: "select 1" },
    ]);
    expect(noteBlocks("```sql")).toEqual([]);
  });

  it("leaves anything else, HTML included, as the text it is", () => {
    expect(noteBlocks("<img src=x onerror=alert(1)>")).toEqual([
      { kind: "text", text: "<img src=x onerror=alert(1)>" },
    ]);
  });
});

describe("nearestDock", () => {
  it("snaps to the edge the point is nearest", () => {
    expect(nearestDock(10, 300, 1000, 600)).toBe("left");
    expect(nearestDock(990, 300, 1000, 600)).toBe("right");
    expect(nearestDock(500, 10, 1000, 600)).toBe("top");
    expect(nearestDock(500, 590, 1000, 600)).toBe("bottom");
  });

  it("goes to the bottom, where the panel starts, when the point is as near another edge", () => {
    expect(nearestDock(300, 300, 600, 600)).toBe("bottom");
    expect(nearestDock(0, 600, 600, 600)).toBe("bottom");
  });
});

describe("the coach panel and the chat view", () => {
  const view = (globalThis as unknown as { chatViewForTests: { view: string } })
    .chatViewForTests;
  const serveNotes = () => {
    const fetched = vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: 1, notes: [note()] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("shows the notes it reads in the original view", async () => {
    serveNotes();
    render(<CoachNotes enabled />);
    expect(await screen.findByTestId("pn-coach")).toHaveTextContent(
      "Coach · 1 note",
    );
    expect(screen.getByTestId("pn-coach-note")).toHaveTextContent(
      "Name the Outbox pattern",
    );
  });

  it.each(["coach", "conversation", "prompter"])(
    "draws nothing and reads nothing while the view is %s",
    async (chosen) => {
      view.view = chosen;
      const fetched = serveNotes();
      const { container } = render(<CoachNotes enabled />);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("pn-coach")).toBeNull();
      expect(fetched).not.toHaveBeenCalled();
    },
  );

  it("is still the docked panel in the transcript-only view", async () => {
    view.view = "transcript";
    serveNotes();
    render(<CoachNotes enabled />);
    expect(await screen.findByTestId("pn-coach")).toBeInTheDocument();
  });

  it("draws nothing while the session is not open", async () => {
    const fetched = serveNotes();
    const { container } = render(<CoachNotes enabled={false} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
    expect(fetched).not.toHaveBeenCalled();
  });
});
