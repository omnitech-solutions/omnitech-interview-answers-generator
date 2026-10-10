// The panel as the plan names it, and the check that a name a note carries is
// one the coach was given.
import { describe, expect, it } from "vitest";
import { rosterOf, voiceAmong } from "./roster";

describe("the roster in a plan", () => {
  it("reads the documented line: names, and in brackets what each judges", () => {
    expect(
      rosterOf(
        "Panel round, about an hour.\npanel: Priya (hiring manager), Marcus (staff engineer: reliability), Tom\nSalary: ask for the range first.",
      ),
    ).toEqual([
      { name: "Priya", judges: "hiring manager" },
      { name: "Marcus", judges: "staff engineer: reliability" },
      { name: "Tom" },
    ]);
  });

  it("keeps a comma inside the brackets with its person", () => {
    expect(
      rosterOf(
        "panel: Marcus (staff engineer: reliability, payments, data), Aisha (people team: right to work, notice, salary)",
      ),
    ).toEqual([
      { name: "Marcus", judges: "staff engineer: reliability, payments, data" },
      { name: "Aisha", judges: "people team: right to work, notice, salary" },
    ]);
  });

  it.each([
    "Panel: Priya, Marcus",
    "PANEL: Priya, Marcus",
    "panelists: Priya, Marcus",
    "Interviewers: Priya; Marcus",
    "Who is there: Priya, and Marcus.",
    "- panel: Priya, Marcus",
    "## Panel: Priya, Marcus",
    "**Panel**: Priya, Marcus",
    "  panel:Priya,Marcus",
  ])("is forgiving about how the line is written: %j", (line) => {
    expect(rosterOf(line).map((each) => each.name)).toEqual([
      "Priya",
      "Marcus",
    ]);
  });

  it("takes what a person judges after a dash or a colon as well", () => {
    expect(
      rosterOf(
        "panel: Priya - hiring manager, Tom: pushes back, Anne-Marie – product",
      ),
    ).toEqual([
      { name: "Priya", judges: "hiring manager" },
      { name: "Tom", judges: "pushes back" },
      { name: "Anne-Marie", judges: "product" },
    ]);
  });

  it("takes a full name of up to three words", () => {
    expect(
      rosterOf("panel: Mary Ann O'Neil (director), Dr. Lee").map(
        (each) => each.name,
      ),
    ).toEqual(["Mary Ann O'Neil", "Dr. Lee"]);
  });

  it("leaves out what is not a name, and keeps the rest", () => {
    expect(
      rosterOf(
        "panel: Priya, the whole platform team, two people from product, Somebody With Too Many Names, 3 engineers, Tom",
      ).map((each) => each.name),
    ).toEqual(["Priya", "Tom"]);
  });

  it("names each person once, by the first mention", () => {
    expect(
      rosterOf(
        "panel: Priya (hiring manager), priya (again)\ninterviewers: Tom, Priya",
      ),
    ).toEqual([{ name: "Priya", judges: "hiring manager" }, { name: "Tom" }]);
  });

  it("holds at most eight people and cuts a long description", () => {
    const many = Array.from(
      { length: 12 },
      (_, at) => `P${"abcdefghijkl"[at]}`,
    );
    expect(rosterOf(`panel: ${many.join(", ")}`)).toHaveLength(8);
    expect(
      rosterOf(`panel: Priya (${"x".repeat(400)})`)[0]?.judges,
    ).toHaveLength(120);
  });

  it.each([
    undefined,
    "",
    "Screening call with the hiring manager for a tech lead role.",
    "She is judging: architecture judgement, reliability.",
    "mode: system-design\nRound with the head of platform.",
    "The panel is five people.",
    "panel:",
    "panel: tbc",
  ])("is empty for a plan that names no panel: %j", (plan) => {
    expect(rosterOf(plan)).toEqual([]);
  });

  it("does not read a roster out of a sentence that only mentions a panel", () => {
    expect(rosterOf("Ask the panel: Who owns the rules tool?")).toEqual([]);
  });
});

describe("a name the coach was given", () => {
  const PANEL = ["Priya", "Marcus Lee", "Tom"];

  it("is the given name, in its own spelling", () => {
    expect(voiceAmong("tom", PANEL)).toBe("Tom");
    expect(voiceAmong(" PRIYA ", PANEL)).toBe("Priya");
    expect(voiceAmong("Marcus Lee", PANEL)).toBe("Marcus Lee");
  });

  it("is found by a first name when only one person has it", () => {
    expect(voiceAmong("Marcus", PANEL)).toBe("Marcus Lee");
    expect(voiceAmong("Marcus", ["Marcus Lee", "Marcus Ode"])).toBeUndefined();
  });

  it("is nobody for more than a known name: a surname nobody gave, or two people", () => {
    expect(voiceAmong("Tom Park", PANEL)).toBeUndefined();
    expect(voiceAmong("Tom and Priya", PANEL)).toBeUndefined();
    expect(voiceAmong("Marcus Ode", PANEL)).toBeUndefined();
  });

  it("ignores what follows the name in brackets and a closing mark", () => {
    expect(voiceAmong("Tom (engineering director)", PANEL)).toBe("Tom");
    expect(voiceAmong("Tom.", PANEL)).toBe("Tom");
  });

  it.each([undefined, "", "  ", "Dana", "the interviewer", "Tomas", "To"])(
    "is nobody for %j",
    (said) => {
      expect(voiceAmong(said, PANEL)).toBeUndefined();
    },
  );

  it("is nobody when no names were given", () => {
    expect(voiceAmong("Tom", [])).toBeUndefined();
  });
});
