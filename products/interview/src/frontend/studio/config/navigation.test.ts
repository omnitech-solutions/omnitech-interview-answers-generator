import { describe, expect, it } from "vitest";
import { navigationItems, paletteItems } from "./navigation";

const lists = {
  questions: [
    {
      artifactId: "q",
      title: "Question",
      kind: "coding" as const,
      language: null,
      updatedAt: "now",
    },
  ],
  briefs: [],
  briefings: [{ id: "p", title: "Pack", updatedAt: "now" }],
};
describe("navigation data", () => {
  it("maps shortcuts, active state, the session marker, and product links", () => {
    const items = navigationItems({
      views: [
        {
          id: "live",
          label: "Live",
          icon: "sensors",
          goKey: "L",
          indicator: "session-open",
        },
      ],
      products: [
        {
          productId: "interview",
          name: "Interview",
          icon: "forum",
          href: "/interview",
          current: true,
        },
        {
          productId: "presentation",
          name: "Presentation",
          icon: "slideshow",
          href: "/presentation",
          current: false,
        },
      ],
      recent: lists.questions,
      indicators: { "session-open": true },
      current: { view: "work", artifact: "q" },
    });
    expect(items[0]).toMatchObject({
      shortcut: ["G", "L"],
      indicator: { label: "Session in progress", tone: "danger" },
      current: false,
    });
    expect(items[1]?.children).toEqual([
      {
        key: "product:presentation",
        label: "Presentation",
        href: "/presentation",
        icon: "grid_view",
      },
    ]);
    expect(items[2]?.children?.[0]).toMatchObject({
      key: "question:q",
      current: true,
    });
  });
  it("filters unavailable commands, keeps groups and shortcuts, and includes saved lists", () => {
    const result = paletteItems({
      commands: [
        {
          id: "run",
          group: "Actions",
          label: "Run tests",
          icon: "play_arrow",
          shortcut: "mod+enter",
          when: ({ view }) => view === "work",
        },
      ],
      lists,
      context: { view: "home" },
    });
    expect(result.map((item) => item.id)).toEqual(["question:q", "pack:p"]);
    expect(
      paletteItems({
        commands: [
          {
            id: "home",
            group: "Go to",
            label: "Home",
            icon: "home",
            shortcut: "g h",
          },
        ],
        lists,
        context: { view: "home" },
      })[0],
    ).toMatchObject({ group: "Go to", shortcut: "g h" });
  });
  it("omits an inactive indicator and caps recent questions at six", () => {
    const result = navigationItems({
      views: [
        {
          id: "live",
          label: "Live",
          icon: "sensors",
          goKey: "L",
          indicator: "session-open",
        },
      ],
      products: [],
      recent: Array.from({ length: 8 }, (_, i) => ({
        ...lists.questions[0]!,
        artifactId: String(i),
      })),
      indicators: {},
      current: { view: "live" },
    });
    expect(result[0]).not.toHaveProperty("indicator");
    expect(result.at(-1)?.children).toHaveLength(6);
  });
});
