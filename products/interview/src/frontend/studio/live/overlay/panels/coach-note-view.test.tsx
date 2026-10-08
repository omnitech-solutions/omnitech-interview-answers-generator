// One coaching note, drawn: how any note (structured, Markdown or plain
// points) is read into sections of lines, and how the library's CueCard draws
// them in full and in the compact form. Mermaid is a stand-in: nothing is drawn by the
// real library here.
import type { CoachNote } from "@omnitech/interview-contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COACH_COLOUR, CoachNoteView, drawnSections } from "./coach-note-view";

// Plain functions, so no mock reset can take the drawing away.
vi.mock("mermaid", () => ({
  default: {
    initialize: () => undefined,
    render: async (_id: string, source: string) => ({
      svg: `<svg data-drawn="${source.length}"></svg>`,
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Segment =
  CoachNote["sections"][number]["lines"][number]["segments"][number];
const piece = (
  text: string,
  role: Segment["role"] = "spoken",
  extra: Partial<Segment> = {},
): Segment => ({ text, role, ...extra });
const line = (...segments: (string | Segment)[]) => ({
  segments: segments.map((segment) =>
    typeof segment === "string" ? piece(segment) : segment,
  ),
});
const note = (extra: Partial<CoachNote> = {}): CoachNote => ({
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-08T17:40:00.000Z",
  title: "Data consistency",
  tone: "say",
  kind: "direct-answer",
  revision: 1,
  status: "ready",
  sections: [],
  points: [],
  links: [],
  ...extra,
});
const written = (markdown: string, extra: Partial<CoachNote> = {}) =>
  drawnSections(note({ markdown, ...extra }));
// A drawn section in short: its kind, its label and its lines as text.
const short = (drawn: ReturnType<typeof drawnSections>) =>
  drawn.sections.map((section) => [
    section.kind,
    section.label,
    section.lines.map((each) =>
      each.segments.map((segment) => segment.text).join(""),
    ),
  ]);
// The library's CueCard colours by tone, in its own classes: which tone an
// element takes is what is read here, never the colour value.
const toneOf = (element: Element | null | undefined) =>
  /--oui-(?:tone-(\w+)-fg|panel-(meta)-fg)/
    .exec(element?.getAttribute("class") ?? "")
    ?.slice(1)
    .find(Boolean) ?? null;

describe("drawnSections: a structured note", () => {
  it("is drawn as it is, each section under its kind's label unless it has its own", () => {
    const lines = [line("One")];
    expect(
      drawnSections(
        note({
          sections: [
            { kind: "say", lines },
            { kind: "anchors", lines },
            { kind: "ask", lines },
            { kind: "caution", label: "If pushed", lines },
          ],
        }),
      ),
    ).toEqual({
      sections: [
        { kind: "say", label: "Say this", lines },
        { kind: "anchors", label: "Anchors", lines },
        { kind: "ask", label: "Ask", lines },
        { kind: "caution", label: "If pushed", lines },
      ],
      diagrams: [],
    });
    expect(
      drawnSections(note({ sections: [{ kind: "context", lines }] })).sections,
    ).toEqual([{ kind: "context", label: "Context", lines }]);
  });

  it("its diagram is the one drawing, and it has none unless given", () => {
    const sections = [{ kind: "say" as const, lines: [line("One")] }];
    expect(
      drawnSections(note({ sections, diagram: "flowchart LR" })).diagrams,
    ).toEqual(["flowchart LR"]);
    expect(drawnSections(note({ sections })).diagrams).toEqual([]);
  });

  it("its sections stand whatever else it carries: its Markdown, its points and a watch tone are not read", () => {
    const sections = [{ kind: "say" as const, lines: [line("One")] }];
    expect(
      short(
        drawnSections(
          note({
            sections,
            tone: "watch",
            points: ["A point"],
            markdown: "## Avoid\n- this\n```mermaid\nflowchart LR\n```",
          }),
        ),
      ),
    ).toEqual([["say", "Say this", ["One"]]]);
  });
});

describe("drawnSections: a note written as points or Markdown", () => {
  it("plain points are one say section, a line to a point", () => {
    expect(
      short(drawnSections(note({ points: ["Name the Outbox", "Then Saga"] }))),
    ).toEqual([["say", "Say this", ["Name the Outbox", "Then Saga"]]]);
  });

  it("a note with nothing to say has no sections", () => {
    expect(drawnSections(note())).toEqual({ sections: [], diagrams: [] });
  });

  it("text before any heading is what to say", () => {
    expect(short(written("Lead with the result you got."))).toEqual([
      ["say", "Say this", ["Lead with the result you got."]],
    ]);
  });

  it.each([
    ["Avoid", "caution"],
    ["Watch out", "caution"],
    ["Careful here", "caution"],
    ["Steer back", "caution"],
    ["Fix", "caution"],
    ["Delivery", "caution"],
    ["Do not say", "caution"],
    ["Don't ramble", "caution"],
    ["AVOID THIS", "caution"],
    ["Ask", "ask"],
    ["Then ask", "ask"],
    ["Ask them", "ask"],
    ["Questions for them", "ask"],
    ["Question to raise", "ask"],
    ["Why she asks", "context"],
    ["Context", "context"],
    ["What she is looking for", "context"],
    ["Background", "context"],
    ["Say", "say"],
    ["Opening", "say"],
    ["If pushed", "say"],
    // "Asking" is not the word "ask".
    ["Asking price", "say"],
    // A caution word wins over the others.
    ["Why to avoid it", "caution"],
    ["Ask, but watch the time", "caution"],
  ] as const)(
    "a heading %j opens a %s section under those words",
    (heading, kind) => {
      expect(short(written(`## ${heading}\n- A line`))).toEqual([
        [kind, heading, ["A line"]],
      ]);
    },
  );

  it("each heading opens its own section, in the order written, and its bold marks are dropped", () => {
    expect(
      short(
        written(
          "## **Say**\n- Lead with the result\n### Avoid\n- Naming the client\n# Then ask\n- What does success look like?",
        ),
      ),
    ).toEqual([
      ["say", "Say", ["Lead with the result"]],
      ["caution", "Avoid", ["Naming the client"]],
      ["ask", "Then ask", ["What does success look like?"]],
    ]);
  });

  it("a heading of up to 28 characters is a label; a longer one is context, small, with what follows it under Say this", () => {
    const label = "a".repeat(28);
    expect(short(written(`## ${label}\n- A line`))).toEqual([
      ["say", label, ["A line"]],
    ]);
    const sentence = "She is probing for trade-offs";
    expect(sentence).toHaveLength(29);
    const drawn = written(`## ${sentence}\n- A line`);
    expect(short(drawn)).toEqual([
      ["context", "", [sentence]],
      ["say", "Say this", ["A line"]],
    ]);
    expect(drawn.sections[0]?.lines).toEqual([
      { segments: [{ text: sentence, role: "context" }] },
    ]);
  });

  it("the length that decides is the heading's without its bold marks", () => {
    const label = "a".repeat(28);
    expect(short(written(`## **${label}**\n- A line`))).toEqual([
      ["say", label, ["A line"]],
    ]);
  });

  it("a long heading with nothing after it is only the context line", () => {
    expect(short(written("## She is probing for trade-offs here"))).toEqual([
      ["context", "", ["She is probing for trade-offs here"]],
    ]);
  });

  it("a heading with nothing under it is not drawn", () => {
    expect(short(written("## Say\n## Avoid\n- Naming the client"))).toEqual([
      ["caution", "Avoid", ["Naming the client"]],
    ]);
    expect(short(written("## Say"))).toEqual([]);
  });

  it("a paragraph is one line to a sentence, a fragment kept with the one before", () => {
    expect(
      short(
        written(
          "Start from the Outbox pattern here. One transaction writes both rows. It worked.",
        ),
      ),
    ).toEqual([
      [
        "say",
        "Say this",
        [
          "Start from the Outbox pattern here.",
          "One transaction writes both rows. It worked.",
        ],
      ],
    ]);
  });

  it("a bullet or a numbered step is one line as written, two sentences and all", () => {
    expect(
      short(
        written(
          "- Name the Outbox. Say why it is safe.\n- Then the Saga\n1. Write the row\n2. Relay it",
        ),
      ),
    ).toEqual([
      [
        "say",
        "Say this",
        [
          "Name the Outbox. Say why it is safe.",
          "Then the Saga",
          "Write the row",
          "Relay it",
        ],
      ],
    ]);
  });

  it("paragraphs and lists under one heading are one section's lines, in order", () => {
    expect(
      short(written("## Say\nLead with the result you got.\n- Then how")),
    ).toEqual([["say", "Say", ["Lead with the result you got.", "Then how"]]]);
  });

  it("bold is the line's evidence, and the rest is spoken", () => {
    expect(
      written("- Start from the **Outbox** at **Acme**").sections[0]?.lines,
    ).toEqual([
      {
        segments: [
          { text: "Start from the ", role: "spoken" },
          { text: "Outbox", role: "evidence" },
          { text: " at ", role: "spoken" },
          { text: "Acme", role: "evidence" },
        ],
      },
    ]);
    expect(written("- **Outbox** first").sections[0]?.lines).toEqual([
      {
        segments: [
          { text: "Outbox", role: "evidence" },
          { text: " first", role: "spoken" },
        ],
      },
    ]);
    expect(
      drawnSections(note({ points: ["Name the **Saga**"] })).sections[0]?.lines,
    ).toEqual([
      {
        segments: [
          { text: "Name the ", role: "spoken" },
          { text: "Saga", role: "evidence" },
        ],
      },
    ]);
  });

  it("double quotation marks are dropped wherever they stand, straight or curly; an apostrophe stays", () => {
    expect(
      short(
        written(
          "- \"We write the row once.\"\n- Say “compensating action” here\n- It's the team's call",
        ),
      ),
    ).toEqual([
      [
        "say",
        "Say this",
        [
          "We write the row once.",
          "Say compensating action here",
          "It's the team's call",
        ],
      ],
    ]);
  });

  it("a mermaid fence is a diagram, in the order written, and is no line of any section", () => {
    const drawn = written(
      "## Say\n- One\n```mermaid\nflowchart LR\n  A --> B\n```\n- Two\n```mermaid\nsequenceDiagram\n```",
    );
    expect(drawn.diagrams).toEqual([
      "flowchart LR\n  A --> B",
      "sequenceDiagram",
    ]);
    expect(short(drawn)).toEqual([["say", "Say", ["One", "Two"]]]);
  });

  it("a note that is only a diagram has the diagram and no sections", () => {
    expect(written("```mermaid\nflowchart LR\n```")).toEqual({
      sections: [],
      diagrams: ["flowchart LR"],
    });
  });

  it("a note to watch is all caution: every section, whatever its heading, and the one with none is Careful", () => {
    expect(
      short(
        written("Slow down a little here.\n## Say\n- Then the Outbox", {
          tone: "watch",
        }),
      ),
    ).toEqual([
      ["caution", "Careful", ["Slow down a little here."]],
      ["caution", "Say", ["Then the Outbox"]],
    ]);
    expect(
      short(
        drawnSections(note({ tone: "watch", points: ["Not exactly-once"] })),
      ),
    ).toEqual([["caution", "Careful", ["Not exactly-once"]]]);
  });
});

describe("CoachNoteView", () => {
  const view = (
    extra: Partial<CoachNote>,
    mode?: "detail" | "compact",
  ): HTMLElement => {
    const { container } = render(
      <CoachNoteView note={note(extra)} {...(mode ? { mode } : {})} />,
    );
    return container.querySelector(
      '[data-testid="pn-coach-note"]',
    ) as HTMLElement;
  };
  const SECTION = '[data-slot="cue-card-section"]';
  const LINE = '[data-slot="cue-card-line"]';
  const LABEL = '[data-slot="cue-card-label"]';
  const PIECE = '[data-slot="cue-card-segment"]';
  const sections = (root: HTMLElement) => [
    ...root.querySelectorAll<HTMLElement>(SECTION),
  ];
  const section = (root: HTMLElement, kind: string) =>
    root.querySelector<HTMLElement>(
      `${SECTION}[data-kind="${kind}"]`,
    ) as HTMLElement;
  const kinds = (root: HTMLElement) =>
    sections(root).map((each) => each.getAttribute("data-kind"));
  const lines = (within: HTMLElement) => [
    ...within.querySelectorAll<HTMLElement>(LINE),
  ];
  const linesText = (within: HTMLElement) =>
    lines(within).map((each) => each.textContent);
  const ALL: CoachNote["sections"] = [
    { kind: "say", lines: [line("Say one"), line("Say two")] },
    { kind: "anchors", lines: [line("Anchor one")] },
    { kind: "ask", lines: [line("Ask one")] },
    { kind: "caution", lines: [line("Off track"), line("The line back")] },
  ];

  it("is the library's cue card, and says what it is: its kind, its status and how it is drawn (in full unless asked otherwise)", () => {
    const root = view({ kind: "behavioral", sections: ALL });
    expect(root.tagName).toBe("ARTICLE");
    expect(root).toHaveAttribute("data-slot", "cue-card");
    expect(root).toHaveAttribute("data-kind", "behavioral");
    expect(root).toHaveAttribute("data-status", "ready");
    expect(root).toHaveAttribute("data-mode", "detail");
    expect(root).toHaveAttribute("data-text-surface", "");
    expect(within(root).queryByRole("status")).toBeNull();
  });

  it.each([
    ["say", "Say this", "success"],
    ["anchors", "Anchors", "accent"],
    ["ask", "Ask", "success"],
    ["caution", "Careful", "warning"],
    ["context", "Context", "meta"],
  ] as const)(
    "a %s section is labelled %s in its kind's tone (%s), the words inside left to their own",
    (kind, label, tone) => {
      const root = view({ sections: [{ kind, lines: [line("The line")] }] });
      expect(kinds(root)).toEqual([kind]);
      const drawn = within(section(root, kind)).getByText(label);
      expect(drawn).toHaveAttribute("data-slot", "cue-card-label");
      expect(toneOf(drawn)).toBe(tone);
      // The words of the line take no tone from the label.
      expect(toneOf(root.querySelector(PIECE))).toBeNull();
      // A section's own heading takes the same tone.
      const own = view({
        sections: [{ kind, label: "If pushed", lines: [line("The line")] }],
      });
      expect(toneOf(within(own).getByText("If pushed"))).toBe(tone);
      expect(within(own).queryByText(label)).toBeNull();
    },
  );

  it("the colours are the one vocabulary: green to act, blue for evidence, amber for caution, grey for context, white to read", () => {
    expect(COACH_COLOUR).toEqual({
      act: "#3ecf72",
      evidence: "#7cb4ff",
      caution: "#f5b84a",
      context: "#8e8e93",
      read: "#f2f2f3",
    });
  });

  it("what to say and what to ask are a sentence to a line, each on its own mark", () => {
    const root = view({ sections: ALL });
    for (const kind of ["say", "ask"]) {
      const drawn = lines(section(root, kind));
      expect(drawn.length).toBeGreaterThan(0);
      for (const each of drawn) {
        const mark = each.previousElementSibling as HTMLElement;
        expect(mark).toHaveAttribute("aria-hidden", "true");
        expect(mark.textContent).toBe("");
        expect(each.tagName).toBe("P");
        // The sentence itself takes no tone: it is the text to read.
        expect(toneOf(each)).toBeNull();
      }
    }
    expect(linesText(section(root, "say"))).toEqual(["Say one", "Say two"]);
    expect(linesText(section(root, "ask"))).toEqual(["Ask one"]);
  });

  it("context is grey with no mark: it is read later, never said", () => {
    const root = view({
      sections: [
        { kind: "say", lines: [line("Say one")] },
        { kind: "context", lines: [line("Why she asks")] },
      ],
    });
    const [read] = lines(section(root, "context"));
    expect(read?.textContent).toBe("Why she asks");
    expect(toneOf(read)).toBe("meta");
    expect(read?.previousElementSibling).toBeNull();
    expect(toneOf(lines(section(root, "say"))[0])).toBeNull();
  });

  it("anchors are rows on a blue mark, one to an anchor", () => {
    const root = view({
      sections: [
        { kind: "anchors", lines: [line("Acme, 2021"), line("40% fewer")] },
      ],
    });
    const anchors = section(root, "anchors");
    const marks = [
      ...anchors.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
    ];
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(toneOf(mark)).toBe("accent");
      expect(mark.nextElementSibling?.textContent).toMatch(/Acme|40%/);
    }
    expect(linesText(anchors)).toEqual(["Acme, 2021", "40% fewer"]);
  });

  it("anchors that come straight after what to say are nested under it; anchors that open a note stand on their own", () => {
    const anchors = (text: string) => ({
      kind: "anchors" as const,
      lines: [line(text)],
    });
    const root = view({
      sections: [
        anchors("Before anything"),
        { kind: "say", lines: [line("Say one")] },
        anchors("Under the say"),
      ],
    });
    expect(
      sections(root).map((each) => [
        each.getAttribute("data-kind"),
        each.hasAttribute("data-nested"),
      ]),
    ).toEqual([
      ["anchors", false],
      ["say", false],
      ["anchors", true],
    ]);
    // Nested or not, every anchor is drawn, in the order given.
    expect(linesText(root)).toEqual([
      "Before anything",
      "Say one",
      "Under the say",
    ]);
  });

  it("a caution is the amber box with the warning icon: what is off, then the lines that get back on track in the reading colour", () => {
    const root = view({ sections: ALL });
    const box = section(root, "caution");
    expect(box.getAttribute("class")).toContain("--oui-tone-warning-border");
    expect(box.getAttribute("class")).toContain("--oui-tone-warning-bg");
    expect(toneOf(box)).toBe("warning");
    expect(box.querySelector("svg")).not.toBeNull();
    const drawn = lines(box);
    expect(drawn.map((each) => each.textContent)).toEqual([
      "Off track",
      "The line back",
    ]);
    // The first line keeps the box's amber; the way back is set apart from it.
    expect(drawn[0]?.getAttribute("class")).not.toContain("--oui-foreground");
    expect(drawn[1]?.getAttribute("class")).toContain("--oui-foreground");
    // No other section is boxed, and none carries the icon.
    for (const kind of ["say", "anchors", "ask"]) {
      expect(section(root, kind).getAttribute("class")).not.toContain(
        "--oui-tone-warning",
      );
      expect(section(root, kind).querySelector("svg")).toBeNull();
    }
  });

  it("sections are drawn in the order given, a kind as often as it comes", () => {
    const root = view({
      sections: [
        { kind: "caution", lines: [line("First")] },
        { kind: "say", lines: [line("Second")] },
        { kind: "say", label: "If pushed", lines: [line("Third")] },
      ],
    });
    expect(kinds(root)).toEqual(["caution", "say", "say"]);
    expect(root).toHaveTextContent("CarefulFirstSay thisSecondIf pushedThird");
  });

  it("each piece of a line says its role, and is toned by it alone", () => {
    const root = view({
      sections: [
        {
          kind: "say",
          lines: [
            line(
              piece("One thing I should add: ", "cue"),
              "at ",
              piece("Acme", "evidence"),
              piece(" (not the client)", "caution"),
              piece(" in 2021", "context"),
            ),
          ],
        },
      ],
    });
    const pieces = [...root.querySelectorAll<HTMLElement>("[data-role]")];
    expect(pieces.map((each) => each.getAttribute("data-role"))).toEqual([
      "cue",
      "spoken",
      "evidence",
      "caution",
      "context",
    ]);
    // The spaces that join the pieces are kept as written.
    expect(lines(section(root, "say"))[0]?.textContent).toBe(
      "One thing I should add: at Acme (not the client) in 2021",
    );
    // The way in and the spoken words take no colour of their own.
    expect(pieces.map(toneOf)).toEqual([
      null,
      null,
      "accent",
      "warning",
      "meta",
    ]);
    expect(pieces[1]?.getAttribute("class") ?? "").toBe("");
    // Nothing is coloured inline: the card's tones are the library's.
    for (const each of pieces) expect(each).not.toHaveAttribute("style");
  });

  it("a claim that is only inferred is marked: a dotted underline in the warning tone and a word of warning on hover; a verified or unmarked one is not", () => {
    const root = view({
      sections: [
        {
          kind: "anchors",
          lines: [
            line(
              piece("Acme", "evidence", { grounding: "inferred" }),
              piece("Relay", "evidence", { grounding: "verified" }),
              piece("Outbox", "evidence"),
            ),
          ],
        },
      ],
    });
    const [inferred, verified, plain] = [
      ...root.querySelectorAll<HTMLElement>("[data-role]"),
    ];
    expect(inferred).toHaveAttribute(
      "title",
      "Not confirmed: check before saying",
    );
    expect(inferred?.getAttribute("class")).toContain("decoration-dotted");
    expect(inferred?.getAttribute("class")).toContain(
      "decoration-[color:var(--oui-tone-warning-fg)]",
    );
    // It is still drawn as the evidence it is.
    expect(toneOf(inferred)).toBe("accent");
    for (const each of [verified, plain]) {
      expect(each).not.toHaveAttribute("title");
      expect(each?.getAttribute("class")).not.toContain("decoration");
      expect(toneOf(each)).toBe("accent");
    }
  });

  it("an inferred piece of any role is marked the same way", () => {
    const root = view({
      sections: [
        {
          kind: "say",
          lines: [
            line(piece("We led it", "spoken", { grounding: "inferred" })),
          ],
        },
      ],
    });
    const said = root.querySelector<HTMLElement>("[data-role]");
    expect(said).toHaveAttribute("title", "Not confirmed: check before saying");
    expect(said?.getAttribute("class")).toContain("decoration-dotted");
    expect(toneOf(said)).toBe("warning");
    expect(said?.getAttribute("class")).not.toContain("--oui-tone-accent-fg");
  });

  it("a piece that names its source carries the pointer; one that does not carries none", () => {
    const root = view({
      sections: [
        {
          kind: "say",
          lines: [
            line(
              "At ",
              piece("Acme", "evidence", { source: "/roles/3/proof_points/1" }),
            ),
          ],
        },
      ],
    });
    const [plain, pointed] = [...root.querySelectorAll("[data-role]")];
    expect(pointed).toHaveAttribute("data-source", "/roles/3/proof_points/1");
    expect(plain).not.toHaveAttribute("data-source");
  });

  it("a note written as Markdown is drawn in the same shape: sections, lines and evidence", () => {
    const root = view({
      markdown:
        "## Say\nStart from the **Outbox** pattern here. One transaction writes both rows.\n## Avoid\n- “Exactly-once”",
    });
    expect(kinds(root)).toEqual(["say", "caution"]);
    expect(linesText(root)).toEqual([
      "Start from the Outbox pattern here.",
      "One transaction writes both rows.",
      "Exactly-once",
    ]);
    expect(root.querySelector('[data-role="evidence"]')).toHaveTextContent(
      /^Outbox$/,
    );
    expect(root).not.toHaveTextContent("**");
  });

  it("a heading written as a sentence is a grey line with no label over it", () => {
    const root = view({
      markdown: "## She is probing for trade-offs here\n- Lead with the result",
    });
    expect(kinds(root)).toEqual(["context", "say"]);
    const context = section(root, "context");
    expect(context.textContent).toBe("She is probing for trade-offs here");
    expect(context.querySelector(LABEL)).toBeNull();
    expect(within(context).queryByText("Context")).toBeNull();
    expect(toneOf(lines(context)[0])).toBe("meta");
  });

  describe("in full", () => {
    it("draws every section, the diagram and the links", async () => {
      const root = view({
        sections: [
          ...ALL.slice(0, 3),
          { kind: "context", lines: [line("Why")] },
        ],
        diagram: "flowchart LR",
        links: [
          { label: "Saga reference", url: "https://example.com/saga" },
          { label: "Outbox", url: "https://example.com/outbox" },
        ],
      });
      expect(kinds(root)).toEqual(["say", "anchors", "ask", "context"]);
      expect(await screen.findByRole("img", { name: "Diagram" })).toBe(
        within(root).getByTestId("pn-coach-diagram"),
      );
      const links = within(root).getAllByTestId("pn-coach-link");
      expect(links.map((each) => each.textContent)).toEqual([
        "Saga reference",
        "Outbox",
      ]);
      expect(links[0]).toHaveAttribute("title", "https://example.com/saga");
    });

    it("a link opens its address outside the window", () => {
      const opened = vi.spyOn(window, "open").mockReturnValue(null);
      const root = view({
        sections: ALL,
        links: [{ label: "Saga reference", url: "https://example.com/saga" }],
      });
      fireEvent.click(within(root).getByTestId("pn-coach-link"));
      expect(opened).toHaveBeenCalledTimes(1);
      expect(opened).toHaveBeenCalledWith(
        "https://example.com/saga",
        "_blank",
        "noopener,noreferrer",
      );
    });

    it("draws each diagram of a written note, after its sections", async () => {
      const root = view({
        markdown:
          "```mermaid\nflowchart LR\n```\n- Walk through it\n```mermaid\nsequenceDiagram\n```",
      });
      const diagrams = await within(root).findAllByTestId("pn-coach-diagram");
      expect(diagrams).toHaveLength(2);
      expect(
        section(root, "say").compareDocumentPosition(
          diagrams[0] as HTMLElement,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("keeps every anchor", () => {
      const root = view({
        sections: [
          {
            kind: "anchors",
            lines: ["A", "B", "C", "D", "E"].map((each) =>
              line(`Anchor ${each}`),
            ),
          },
        ],
      });
      expect(linesText(section(root, "anchors"))).toEqual([
        "Anchor A",
        "Anchor B",
        "Anchor C",
        "Anchor D",
        "Anchor E",
      ]);
    });

    it("has no links row when the note has no links", () => {
      const root = view({ sections: ALL });
      expect(within(root).queryByTestId("pn-coach-link")).toBeNull();
      expect(root.lastElementChild).toBe(section(root, "caution"));
    });
  });

  describe("compact", () => {
    const FULL: Partial<CoachNote> = {
      sections: [
        { kind: "context", lines: [line("Why she asks")] },
        {
          kind: "say",
          lines: ["1", "2", "3", "4", "5"].map((each) => line(`Say ${each}`)),
        },
        { kind: "ask", lines: [line("Ask one")] },
        {
          kind: "anchors",
          lines: ["A", "B", "C", "D", "E"].map((each) =>
            line(`Anchor ${each}`),
          ),
        },
      ],
      diagram: "flowchart LR",
      links: [{ label: "Saga reference", url: "https://example.com/saga" }],
    };

    it("keeps only what to say, the anchors and a caution, in the order given: nothing to read or to ask", () => {
      const root = view(
        {
          sections: [
            { kind: "context", lines: [line("Why she asks")] },
            { kind: "caution", lines: [line("Off track")] },
            { kind: "ask", lines: [line("Ask one")] },
            { kind: "say", lines: [line("Say one")] },
            { kind: "anchors", lines: [line("Anchor one")] },
          ],
        },
        "compact",
      );
      expect(root).toHaveAttribute("data-mode", "compact");
      expect(kinds(root)).toEqual(["caution", "say", "anchors"]);
      expect(root).not.toHaveTextContent("Why she asks");
      expect(root).not.toHaveTextContent("Ask one");
    });

    it("cuts the anchors to the first three, in order, and cuts nothing else", () => {
      const root = view(FULL, "compact");
      expect(linesText(section(root, "anchors"))).toEqual([
        "Anchor A",
        "Anchor B",
        "Anchor C",
      ]);
      expect(linesText(section(root, "say"))).toEqual([
        "Say 1",
        "Say 2",
        "Say 3",
        "Say 4",
        "Say 5",
      ]);
    });

    it("three anchors or fewer are all kept", () => {
      const root = view(
        {
          sections: [
            {
              kind: "anchors",
              lines: ["A", "B", "C"].map((each) => line(`Anchor ${each}`)),
            },
          ],
        },
        "compact",
      );
      expect(linesText(section(root, "anchors"))).toEqual([
        "Anchor A",
        "Anchor B",
        "Anchor C",
      ]);
    });

    it("each anchors section keeps its own first three", () => {
      const anchors = (prefix: string) => ({
        kind: "anchors" as const,
        label: prefix,
        lines: ["1", "2", "3", "4"].map((each) => line(`${prefix}${each}`)),
      });
      const root = view({ sections: [anchors("A"), anchors("B")] }, "compact");
      expect(root.textContent).toBe("AA1A2A3BB1B2B3");
    });

    it("a caution keeps every line: the warning and the line back are never cut", () => {
      const root = view(
        {
          sections: [
            {
              kind: "caution",
              lines: ["1", "2", "3", "4", "5"].map((each) =>
                line(`Line ${each}`),
              ),
            },
          ],
        },
        "compact",
      );
      expect(lines(section(root, "caution"))).toHaveLength(5);
    });

    it("draws no diagram and no links", async () => {
      const root = view(FULL, "compact");
      // Long enough for a diagram to have been drawn, had one been asked for.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(within(root).queryByTestId("pn-coach-diagram")).toBeNull();
      expect(within(root).queryByTestId("pn-coach-diagram-source")).toBeNull();
      expect(within(root).queryByTestId("pn-coach-link")).toBeNull();
      expect(root.querySelector("figure, pre")).toBeNull();
    });

    it("a written note is cut the same way: its context and its questions are left out", () => {
      const root = view(
        {
          markdown:
            "## Why she asks\n- Trade-offs\n## Say\n- Lead with the result\n## Then ask\n- What does success look like?\n## Avoid\n- Naming the client",
        },
        "compact",
      );
      expect(kinds(root)).toEqual(["say", "caution"]);
    });

    it("a note to watch is still its caution", () => {
      const root = view(
        { tone: "watch", points: ["Not exactly-once"] },
        "compact",
      );
      expect(kinds(root)).toEqual(["caution"]);
    });
  });

  describe("a revision being prepared", () => {
    it("with nothing ready yet says it is preparing the response", () => {
      const root = view({ status: "pending" });
      expect(root).toHaveAttribute("data-status", "pending");
      expect(kinds(root)).toEqual([]);
      expect(within(root).getByRole("status").textContent).toBe(
        "Preparing response…",
      );
    });

    it("with something on show keeps it and says it is updating, beneath the sections", () => {
      const root = view({ status: "pending", sections: ALL });
      expect(kinds(root)).toEqual(["say", "anchors", "ask", "caution"]);
      const status = within(root).getByRole("status");
      expect(status.textContent).toBe("Updating…");
      expect(
        section(root, "caution").compareDocumentPosition(status) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("says so last, after the links, which stay", () => {
      const root = view({
        status: "pending",
        sections: ALL,
        links: [{ label: "Saga reference", url: "https://example.com/saga" }],
      });
      const status = within(root).getByRole("status");
      expect(
        within(root)
          .getByTestId("pn-coach-link")
          .compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(root.lastElementChild).toBe(status);
    });

    it("compact says the same of what it draws: updating when a section is on show, preparing when none of its kinds is", () => {
      expect(
        within(view({ status: "pending", sections: ALL }, "compact")).getByRole(
          "status",
        ).textContent,
      ).toBe("Updating…");
      const onlyContext = view(
        {
          status: "pending",
          title: "Only context",
          sections: [{ kind: "context", lines: [line("Why she asks")] }],
        },
        "compact",
      );
      expect(kinds(onlyContext)).toEqual([]);
      expect(within(onlyContext).getByRole("status").textContent).toBe(
        "Preparing response…",
      );
    });

    it("a written note being revised is updating too", () => {
      const root = view({ status: "pending", points: ["Name the Outbox"] });
      expect(within(root).getByRole("status").textContent).toBe("Updating…");
    });

    it("a ready note says neither", () => {
      const root = view({ sections: ALL });
      expect(root).not.toHaveTextContent("Updating…");
      expect(root).not.toHaveTextContent("Preparing response…");
    });
  });
});
