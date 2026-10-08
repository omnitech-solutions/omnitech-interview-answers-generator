// The coach panel: which notes a search finds, how a note's Markdown is read,
// where a dragged panel snaps, and that the panel stands down in a coach view
// (the coach layout draws the notes itself, under their questions).
import type { CoachNote } from "@omnitech/interview-contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CoachNotes,
  lineText,
  matchesNote,
  nearestDock,
  noteBlocks,
  noteMarkdown,
  Prompter,
  talkingPoints,
} from "./coach-notes";

const note = (extra: Partial<CoachNote> = {}): CoachNote => ({
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-08T17:40:00.000Z",
  title: "Data consistency",
  tone: "say",
  kind: "direct-answer",
  revision: 1,
  status: "ready",
  sections: [],
  points: ["Name the Outbox pattern", "Mention idempotent consumers"],
  links: [{ label: "Saga reference", url: "https://example.com/patterns" }],
  ...extra,
});

type Segment =
  CoachNote["sections"][number]["lines"][number]["segments"][number];
const line = (...segments: (string | Segment)[]) => ({
  segments: segments.map((segment) =>
    typeof segment === "string"
      ? { text: segment, role: "spoken" as const }
      : segment,
  ),
});
const evidence = (text: string): Segment => ({ text, role: "evidence" });

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

describe("talkingPoints", () => {
  it("is one point to a whole sentence, whatever ends it", () => {
    expect(
      talkingPoints(
        "Start from the Outbox pattern here. Does one transaction write both rows? It always does in ours!",
      ),
    ).toEqual([
      "Start from the Outbox pattern here.",
      "Does one transaction write both rows?",
      "It always does in ours!",
    ]);
  });

  it("keeps a sentence of under five words with the one before it: a fragment is not a point", () => {
    expect(
      talkingPoints("We moved it to the Outbox pattern. I enjoyed this."),
    ).toEqual(["We moved it to the Outbox pattern. I enjoyed this."]);
    expect(
      talkingPoints(
        "We moved it to the Outbox pattern. It worked. So did the relay. Then we measured it for a month.",
      ),
    ).toEqual([
      "We moved it to the Outbox pattern. It worked. So did the relay.",
      "Then we measured it for a month.",
    ]);
  });

  it("five words are enough to stand alone, and a short first sentence has nothing to join", () => {
    expect(
      talkingPoints("Name the Outbox pattern first. Then name the Saga too."),
    ).toEqual(["Name the Outbox pattern first.", "Then name the Saga too."]);
    expect(
      talkingPoints("Start here. Then name the Outbox pattern first."),
    ).toEqual(["Start here.", "Then name the Outbox pattern first."]);
  });

  it("does not split at a semicolon", () => {
    expect(
      talkingPoints("One transaction writes both rows; there is no dual write"),
    ).toEqual(["One transaction writes both rows; there is no dual write"]);
  });

  it("drops the quotation marks round a scripted line, straight or curly", () => {
    expect(talkingPoints('"We use the outbox for that."')).toEqual([
      "We use the outbox for that.",
    ]);
    expect(talkingPoints("“We use the outbox for that.”")).toEqual([
      "We use the outbox for that.",
    ]);
    expect(
      talkingPoints(
        '"We write the row once." "A relay publishes it after that."',
      ),
    ).toEqual(["We write the row once.", "A relay publishes it after that."]);
  });

  it("keeps the words to land in bold, on whichever side of a sentence end they sit", () => {
    expect(
      talkingPoints(
        "Start from the **Outbox**. **Saga** comes next in this answer.",
      ),
    ).toEqual([
      "Start from the **Outbox**.",
      "**Saga** comes next in this answer.",
    ]);
  });

  it("does not split inside a number, or before a word that does not start a sentence", () => {
    expect(talkingPoints("Roughly 3.5 ms a call")).toEqual([
      "Roughly 3.5 ms a call",
    ]);
    expect(talkingPoints("Use it, e.g. for payments and for refunds")).toEqual([
      "Use it, e.g. for payments and for refunds",
    ]);
    expect(
      talkingPoints("It took 5 ms a call. 2 retries at the very most"),
    ).toEqual(["It took 5 ms a call.", "2 retries at the very most"]);
  });

  it("is one point for one sentence, and none for nothing", () => {
    expect(talkingPoints("  Name the criteria  ")).toEqual([
      "Name the criteria",
    ]);
    expect(talkingPoints("")).toEqual([]);
    expect(talkingPoints("   ")).toEqual([]);
    expect(talkingPoints('""')).toEqual([]);
  });
});

describe("lineText", () => {
  it("is the line's pieces joined as written, with its evidence in bold", () => {
    expect(
      lineText(line("Start from the ", evidence("Outbox"), " pattern")),
    ).toBe("Start from the **Outbox** pattern");
    expect(lineText(line("One transaction"))).toBe("One transaction");
    expect(lineText(line(evidence("Acme")))).toBe("**Acme**");
  });

  it("only evidence is bold: a caution or a context piece is plain text", () => {
    expect(
      lineText(
        line(
          "Say ",
          { text: "at-least-once", role: "caution" },
          { text: " (not exactly-once)", role: "context" },
        ),
      ),
    ).toBe("Say at-least-once (not exactly-once)");
  });
});

describe("a structured note", () => {
  const structured = note({
    points: [],
    sections: [
      {
        kind: "say",
        lines: [
          line("Start from the ", evidence("Outbox")),
          line("One transaction"),
        ],
      },
      { kind: "say", label: "If pushed", lines: [line("Name the Saga")] },
    ],
  });

  it("reads as the same Markdown a written note would: each section a heading over its bullets", () => {
    expect(noteMarkdown(structured)).toBe(
      "## Say this\n- Start from the **Outbox**\n- One transaction\n## If pushed\n- Name the Saga",
    );
  });

  it.each([
    ["say", "Say this"],
    ["anchors", "Anchors"],
    ["ask", "Ask"],
    ["caution", "Careful"],
    ["context", "Context"],
  ] as const)(
    "a %s section with no heading of its own is under %s",
    (kind, heading) => {
      expect(
        noteMarkdown(
          note({ points: [], sections: [{ kind, lines: [line("L")] }] }),
        ),
      ).toBe(`## ${heading}\n- L`);
      expect(
        noteMarkdown(
          note({
            points: [],
            sections: [{ kind, label: "Mine", lines: [line("L")] }],
          }),
        ),
      ).toBe("## Mine\n- L");
    },
  );

  it("puts the plain points first, then the sections, then the diagram as a mermaid fence", () => {
    expect(
      noteMarkdown(
        note({
          points: ["Lead with the result"],
          sections: [
            {
              kind: "anchors",
              label: "Proof",
              lines: [line(evidence("40%"), " fewer retries")],
            },
          ],
          diagram: "flowchart LR\n  A --> B",
        }),
      ),
    ).toBe(
      "- Lead with the result\n## Proof\n- **40%** fewer retries\n```mermaid\nflowchart LR\n  A --> B\n```",
    );
    expect(
      noteBlocks(noteMarkdown(note({ points: [], diagram: "flowchart LR" }))),
    ).toEqual([{ kind: "code", language: "mermaid", source: "flowchart LR" }]);
  });

  it("its Markdown reads back into the blocks it was built from", () => {
    expect(noteBlocks(noteMarkdown(structured))).toEqual([
      { kind: "heading", text: "Say this" },
      {
        kind: "list",
        ordered: false,
        items: ["Start from the **Outbox**", "One transaction"],
      },
      { kind: "heading", text: "If pushed" },
      { kind: "list", ordered: false, items: ["Name the Saga"] },
    ]);
  });

  it("its own Markdown stands when it has some, and it says nothing when it has nothing", () => {
    expect(noteMarkdown({ ...structured, markdown: "Just this" })).toBe(
      "Just this",
    );
    expect(noteMarkdown(note({ points: [] }))).toBe("");
  });

  it("is found by its restatement, what was heard and any piece of its sections' lines, whatever its role", () => {
    const full = note({
      points: [],
      ask: "Splitting services",
      heard: "When would you carve out a microservice",
      sections: [
        {
          kind: "anchors",
          label: "Proof",
          lines: [line("Cut ", evidence("deploys"), " to minutes")],
        },
        {
          kind: "caution",
          lines: [
            line(
              { text: "That covers reads only", role: "caution" },
              { text: " (the ledger is separate)", role: "context" },
            ),
          ],
        },
      ],
    });
    for (const word of [
      "splitting",
      "carve",
      "deploys",
      "minutes",
      "reads",
      "ledger",
      "DEPLOYS minutes carve",
    ])
      expect(matchesNote(full, word)).toBe(true);
    expect(matchesNote(full, "kubernetes")).toBe(false);
    expect(matchesNote(full, "deploys kubernetes")).toBe(false);
    // A word written across two pieces of one line is still one word.
    expect(
      matchesNote(
        note({
          points: [],
          sections: [{ kind: "say", lines: [line("Out", "box")] }],
        }),
        "outbox",
      ),
    ).toBe(true);
    // A note without them is still searched by what it has.
    expect(matchesNote(note(), "outbox")).toBe(true);
  });

  it("is not found by a section's heading or its diagram: only by what it says", () => {
    const full = note({
      points: [],
      sections: [{ kind: "say", label: "Proof", lines: [line("One")] }],
      diagram: "flowchart LR",
    });
    expect(matchesNote(full, "proof")).toBe(false);
    expect(matchesNote(full, "flowchart")).toBe(false);
  });
});

describe("a note under its question (inline)", () => {
  const points = (container: HTMLElement) =>
    [...container.querySelectorAll("li")].map((item) => item.textContent);

  it("draws a paragraph as talking points: one bullet to a sentence, never a paragraph", () => {
    const { container } = render(
      <Prompter
        note={note({
          markdown:
            "Start from the **Outbox** pattern. One transaction writes both the rows. A relay publishes it after that.",
        })}
        inline
      />,
    );
    expect(points(container)).toEqual([
      "Start from the Outbox pattern.",
      "One transaction writes both the rows.",
      "A relay publishes it after that.",
    ]);
    expect(container.querySelector("p")).toBeNull();
    // The words to land are still bold.
    expect(container.querySelector("li strong")).toHaveTextContent("Outbox");
  });

  it("draws a bullet as it was written: an item of two sentences stays one point", () => {
    const { container } = render(
      <Prompter
        note={note({
          markdown:
            "- Name the Outbox. Say why it is safe.\n- “Mention idempotent consumers; they matter”",
        })}
        inline
      />,
    );
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(points(container)).toEqual([
      "Name the Outbox. Say why it is safe.",
      "“Mention idempotent consumers; they matter”",
    ]);
  });

  it("draws a structured note's sections as headings over their points", () => {
    const { container } = render(
      <Prompter
        note={note({
          points: [],
          sections: [
            {
              kind: "say",
              lines: [line("Start from the ", evidence("Outbox"))],
            },
            { kind: "say", label: "If pushed", lines: [line("Name the Saga")] },
          ],
        })}
        inline
      />,
    );
    expect(
      within(container)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Say this", "If pushed"]);
    expect(points(container)).toEqual([
      "Start from the Outbox",
      "Name the Saga",
    ]);
    expect(container.querySelector("li strong")).toHaveTextContent("Outbox");
  });

  it("draws a note's plain points as bullets too, with its own dot and no list marker", () => {
    const { container } = render(<Prompter note={note()} inline />);
    expect(points(container)).toEqual([
      "Name the Outbox pattern",
      "Mention idempotent consumers",
    ]);
    const list = container.querySelector("ul") as HTMLElement;
    expect(list.style.listStyle).toContain("none");
    for (const item of list.querySelectorAll("li")) {
      const dot = item.firstElementChild as HTMLElement;
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(dot.textContent).toBe("");
    }
  });

  it("drops the quotation marks of a scripted line", () => {
    const { container } = render(
      <Prompter
        note={note({ markdown: "“We keep one write per request.”" })}
        inline
      />,
    );
    expect(points(container)).toEqual(["We keep one write per request."]);
  });

  it("leaves headings and code as they are, between the bullets", () => {
    const { container } = render(
      <Prompter
        note={note({
          markdown:
            "## Say\nLead with the result you got. Then say how you measured it.\n```ts\nconst a = 1;\n```",
        })}
        inline
      />,
    );
    expect(within(container).getByRole("heading")).toHaveTextContent("Say");
    expect(points(container)).toEqual([
      "Lead with the result you got.",
      "Then say how you measured it.",
    ]);
    expect(container).toHaveTextContent("const a = 1;");
  });
});

describe("a note in the docked coach panel (not inline)", () => {
  it("keeps a paragraph a paragraph and a list item whole, quotation marks and all", () => {
    const { container } = render(
      <Prompter
        note={note({
          markdown:
            "“Start from the Outbox.” One transaction writes both.\n- Name the Outbox. Say why it is safe.",
        })}
      />,
    );
    expect(container.querySelector("p")).toHaveTextContent(
      "“Start from the Outbox.” One transaction writes both.",
    );
    expect(
      [...container.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual(["Name the Outbox. Say why it is safe."]);
  });

  it("draws a structured note as headings over bullets: a caution under Careful, the evidence in bold, and no steer of its own", () => {
    const { container } = render(
      <Prompter
        note={note({
          points: [],
          sections: [
            {
              kind: "say",
              lines: [line("Start from the ", evidence("Outbox"))],
            },
            {
              kind: "caution",
              lines: [line("That covers reads only."), line("For writes…")],
            },
          ],
        })}
      />,
    );
    expect(
      within(container)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Say this", "Careful"]);
    expect(
      [...container.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual([
      "Start from the Outbox",
      "That covers reads only.",
      "For writes…",
    ]);
    expect(container.querySelector("li strong")).toHaveTextContent("Outbox");
    // The title is in the head and nothing stands between it and the sections.
    expect(container.querySelector("header")).toHaveTextContent(
      "SayData consistency",
    );
    expect(container.querySelector("p")).toBeNull();
  });

  it("keeps numbered steps numbered", () => {
    const { container } = render(
      <Prompter note={note({ markdown: "1. Write\n2. Relay" })} />,
    );
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
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
