// The Context tab: the interview brief, the experience matrix and the
// employer's material as the answers are built from them; the matrix read in
// each of its projections, edited as a new revision and restored from an older
// one; the notes edited in place. The brief and the matrix come from stand-ins
// for the two clients; nothing here reaches the network.

import type {
  CandidacyContext,
  CandidateMatrix,
  CoachNote,
  ContextView,
} from "@omnitech/interview-contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextPane } from "./context-pane";
import type { PanelSession } from "./panel-views";

type Imported = {
  name: string;
  matrix: CandidateMatrix;
  profileId?: string;
  expectedRevision?: number;
};
// What the two clients answer, set by each test. Plain functions, so a mock
// reset between tests cannot empty them.
const served = vi.hoisted(() => ({
  context: (_path: string, _init?: RequestInit): Promise<unknown> =>
    Promise.resolve(null),
  profiles: (): Promise<unknown> => Promise.resolve({ profiles: [] }),
  profile: (_id: string, _revision: number): Promise<unknown> =>
    Promise.resolve(null),
  importProfile: (_input: unknown): Promise<unknown> => Promise.resolve(null),
  asked: [] as string[],
  patched: [] as unknown[],
  imported: [] as unknown[],
}));
vi.mock("../../../documents/documents-client", async (original) => ({
  ...(await original<typeof import("../../../documents/documents-client")>()),
  documentJson: (path: string, init?: RequestInit) => {
    served.asked.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.body) served.patched.push(JSON.parse(String(init.body)));
    return served.context(path, init);
  },
}));
vi.mock("@omnitech/interview-api-client", async (original) => ({
  ...(await original<typeof import("@omnitech/interview-api-client")>()),
  createBriefingClient: () => ({
    listProfiles: () => {
      served.asked.push("profiles");
      return served.profiles();
    },
    getProfile: (id: string, revision: number) => {
      served.asked.push(`profile ${id} ${revision}`);
      return served.profile(id, revision);
    },
    importProfile: (input: unknown) => {
      served.imported.push(input);
      return served.importProfile(input);
    },
  }),
}));

type Role = CandidateMatrix["roles"][number];
const role = (company: string, extra: Partial<Role> = {}): Role => ({
  company,
  title: "Developer",
  ...extra,
});
// Seven roles, written in an order that is not their rank against the posting
// below: 100, 75, 50, 25 and three that share nothing with it.
const ROLES: Role[] = [
  role("Acme Corp", { technologies: ["cobol", "fortran", "ada", "lisp"] }),
  role("Relay Platform", {
    period: "2021 to 2024",
    technologies: ["kafka", "postgres", "react", "typescript"],
    metrics: [
      { label: "Deploy time", value: "40 to 6 minutes" },
      { label: "Services", value: 12 },
    ],
    proof_points: ["Moved billing to the outbox", "Cut retries by 40%"],
    leadership_signals: ["Led a team of six"],
  }),
  role("Globex", { technologies: ["perl", "tcl", "awk", "sed"] }),
  role("Initech", { technologies: ["kafka", "postgres", "php", "ruby"] }),
  role("Hooli", { technologies: ["kafka", "postgres", "react", "ruby"] }),
  role("Umbrella", { technologies: ["kafka", "java", "scala", "go"] }),
  role("Stark Industries", { technologies: ["rust", "zig", "nim", "odin"] }),
];
const MATRIX = {
  candidate: {},
  roles: ROLES,
  story_selector: [
    { need: "Conflict", primary_story: "Relay", backup_story: "Hooli" },
    { need: "Failure", primary_story: "Initech" },
  ],
  technology_mappings: [
    { technology: "Kafka", roles: ["Relay", "Umbrella"] },
    { technology: "Rust" },
  ],
} as CandidateMatrix;
const CANDIDACY: CandidacyContext = {
  id: "00000000-0000-4000-8000-0000000000c1",
  companyName: "Northwind",
  title: "Principal",
  jobDescription: "We run kafka, postgres, react and typescript.",
  notes: "Round two is with the CTO.",
  brief: {
    company: "Northwind",
    role: "Principal",
    companyFacts: ["Logistics software for ports"],
    prepNotes: ["Lead with the outbox story"],
    summary: "A platform role over twelve services.",
    mustHaves: ["Event-driven systems", "Postgres at scale"],
    niceToHaves: [],
    techStack: ["Kafka"],
    responsibilities: [],
    values: [],
    questionsToAsk: ["What does success look like?"],
  },
};
const PINNED = { id: "profile-1", revision: 4 };
// The person's matrices as the server lists them; "profile-1" is at revision 4.
let newest = 4;
let matrices: Record<number, CandidateMatrix> = {};

const notify = vi.fn();
const session = (
  candidacyId: string | null = CANDIDACY.id,
  profile: { id: string; revision: number } | null = PINNED,
) =>
  ({
    model: { candidacyId },
    session: profile ? { profile } : null,
    notify,
  }) as unknown as PanelSession;

type Segment =
  CoachNote["sections"][number]["lines"][number]["segments"][number];
const noteWith = (...segments: Segment[]): CoachNote => ({
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-08T17:40:00.000Z",
  title: "Consistency",
  tone: "say",
  kind: "direct-answer",
  revision: 1,
  status: "ready",
  points: [],
  links: [],
  sections: [{ kind: "say", lines: [{ segments }] }],
});
const evidence = (text: string, source?: string): Segment => ({
  text,
  role: "evidence",
  ...(source ? { source } : {}),
});

beforeEach(() => {
  notify.mockReset();
  served.asked = [];
  served.patched = [];
  served.imported = [];
  newest = 4;
  matrices = {};
  served.context = async () => CANDIDACY;
  served.profiles = async () => ({
    profiles: [
      { id: "other", name: "Other matrix", revision: 2, updatedAt: "" },
      { id: "profile-1", name: "Main matrix", revision: newest, updatedAt: "" },
    ],
  });
  served.profile = async (id, revision) => ({
    matrix: matrices[revision] ?? MATRIX,
    name: id === "other" ? "Other matrix" : "Main matrix",
    revision,
  });
  // A save is the next revision, kept so it reads back.
  served.importProfile = async (input) => {
    const { matrix, name, profileId } = input as Imported;
    newest += 1;
    matrices[newest] = matrix;
    return { id: profileId, name, revision: newest, sha256: "0".repeat(64) };
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const artifacts = () => screen.getAllByTestId("pn-context-artifact");
const artifact = (title: string) => {
  const found = artifacts().find((each) =>
    // An artifact opens with the library Divider that names it.
    each.firstElementChild?.textContent?.startsWith(title),
  );
  if (!found) throw new Error(`no artifact titled ${title}`);
  return found;
};
const roles = () => screen.queryAllByTestId("pn-context-role");
const roleIds = () => roles().map((each) => each.getAttribute("data-role-id"));
const roleOf = (id: string) => {
  const found = roles().find(
    (each) => each.getAttribute("data-role-id") === id,
  );
  if (!found) throw new Error(`role ${id} is not on show`);
  return found;
};
const opener = (id: string) =>
  within(roleOf(id)).getAllByRole("button")[0] as HTMLElement;
// Picks an entry of one of the pane's menus.
function pick(trigger: string, menu: string, entry: RegExp) {
  fireEvent.pointerDown(screen.getByTestId(trigger), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    within(screen.getByRole("menu", { name: menu })).getByRole(
      "menuitemradio",
      { name: entry },
    ),
  );
}
const readAs = (label: RegExp) =>
  pick("pn-context-projection", "How the matrix is read", label);
// Drawn, with the brief and the matrix both read.
async function show(s = session(), notes: readonly CoachNote[] = []) {
  const drawn = render(<ContextPane s={s} notes={notes} />);
  await waitFor(() => expect(roles().length).toBeGreaterThan(0));
  await screen.findByText("Northwind · Principal");
  return drawn;
}

describe("ContextPane", () => {
  it("is one pane of three artifacts, in the order the model is given them, each saying how it is used", async () => {
    await show();
    expect(screen.getByTestId("pn-context")).toHaveTextContent(
      "What the answers are built from",
    );
    expect(
      artifacts().map((each) => each.firstElementChild?.textContent),
    ).toEqual([
      "Interview brief",
      "Experience matrix",
      "Job posting and your notes",
    ]);
    for (const each of artifacts())
      expect(each).toHaveTextContent("How the AI uses it");
    expect(artifact("Interview brief")).toHaveTextContent(
      "Leads every answer.",
    );
    expect(artifact("Job posting")).toHaveTextContent(
      "It is treated as untrusted",
    );
  });

  describe("the interview brief", () => {
    it("is read for the session's interview, and laid out by section", async () => {
      await show();
      expect(served.asked).toContain(
        `GET /candidacies/${CANDIDACY.id}/context`,
      );
      const brief = artifact("Interview brief");
      expect(brief).toHaveTextContent("Northwind · Principal");
      // The sections that have something, in the brief's own order.
      expect(brief).toHaveTextContent(
        "About the companyLogistics software for portsYour prepLead with the outbox storySummaryA platform role over twelve services.Must-havesEvent-driven systemsPostgres at scaleTech stackKafkaQuestions to askWhat does success look like?",
      );
      expect(brief).not.toHaveTextContent("Nice-to-haves");
      expect(brief).not.toHaveTextContent("No brief yet");
    });

    it("an interview's id is written into the address safely", async () => {
      await show(session("a/b c"));
      expect(served.asked).toContain("GET /candidacies/a%2Fb%20c/context");
    });

    it("a session with no interview asks for none, and says how to add one", async () => {
      render(<ContextPane s={session(null)} notes={[]} />);
      await waitFor(() => expect(roles().length).toBeGreaterThan(0));
      expect(served.asked.filter((each) => each.includes("/context"))).toEqual(
        [],
      );
      const brief = artifact("Interview brief");
      expect(brief).toHaveTextContent("none for this session");
      expect(brief).toHaveTextContent("No brief yet.");
    });

    it("an interview whose brief is not written yet is named, with no sections", async () => {
      served.context = async () => ({ ...CANDIDACY, brief: null });
      await show();
      const brief = artifact("Interview brief");
      expect(brief).toHaveTextContent("Northwind · Principal");
      expect(brief).toHaveTextContent("No brief yet.");
    });

    it("a brief that cannot be read leaves the pane standing: no brief, the matrix still drawn", async () => {
      served.context = async () => {
        throw new Error("offline");
      };
      render(<ContextPane s={session()} notes={[]} />);
      await waitFor(() => expect(roles().length).toBeGreaterThan(0));
      expect(artifact("Interview brief")).toHaveTextContent(
        "none for this session",
      );
    });
  });

  describe("the experience matrix: which one, and which revision", () => {
    it("is the matrix the session was started with, opened on its newest revision", async () => {
      await show();
      expect(served.asked).toContain("profiles");
      expect(served.asked).toContain("profile profile-1 4");
      expect(artifact("Experience matrix")).toHaveTextContent(
        "Main matrix · 7 roles",
      );
      expect(screen.getByTestId("pn-context-revision")).toHaveTextContent(
        "Revision 4",
      );
      // The session answers from the newest, so there is nothing to say.
      expect(
        within(artifact("Experience matrix")).queryByRole("status"),
      ).toBeNull();
    });

    it("is the first matrix listed when the session names none, or names one that is gone", async () => {
      const first = await show(session(CANDIDACY.id, null));
      expect(served.asked).toContain("profile other 2");
      expect(artifact("Experience matrix")).toHaveTextContent("Other matrix");
      first.unmount();
      served.asked = [];
      await show(session(CANDIDACY.id, { id: "deleted", revision: 9 }));
      expect(served.asked).toContain("profile other 2");
    });

    it("says which revision this session answers from when a newer one exists", async () => {
      await show(session(CANDIDACY.id, { id: "profile-1", revision: 3 }));
      expect(
        within(artifact("Experience matrix")).getByRole("status"),
      ).toHaveTextContent(
        "This session answers from revision 3. Revision 4 is used from the next session.",
      );
      // The pane still opens on the newest.
      expect(screen.getByTestId("pn-context-revision")).toHaveTextContent(
        "Revision 4",
      );
    });

    it("says so when the list of matrices cannot be read", async () => {
      served.profiles = async () => {
        throw new Error("offline");
      };
      render(<ContextPane s={session()} notes={[]} />);
      expect(
        await screen.findByText("The experience matrix could not be read."),
      ).toBeInTheDocument();
      expect(roles()).toEqual([]);
      expect(screen.queryByTestId("pn-context-revision")).toBeNull();
      expect(
        served.asked.filter((each) => each.startsWith("profile ")),
      ).toEqual([]);
    });

    it("says so when the revision cannot be read", async () => {
      served.profile = async () => {
        throw new Error("not found");
      };
      render(<ContextPane s={session()} notes={[]} />);
      expect(
        await screen.findByText("That revision could not be read."),
      ).toBeInTheDocument();
      expect(roles()).toEqual([]);
    });

    it("a person with no matrix has no roles and no revision to pick", async () => {
      served.profiles = async () => ({ profiles: [] });
      render(<ContextPane s={session()} notes={[]} />);
      await screen.findByText("Northwind · Principal");
      expect(roles()).toEqual([]);
      expect(screen.queryByTestId("pn-context-revision")).toBeNull();
      expect(
        served.asked.filter((each) => each.startsWith("profile ")),
      ).toEqual([]);
    });

    it("any revision can be read, each named in the menu: the newest and the session's own are marked", async () => {
      await show(session(CANDIDACY.id, { id: "profile-1", revision: 3 }));
      fireEvent.pointerDown(screen.getByTestId("pn-context-revision"), {
        button: 0,
        ctrlKey: false,
      });
      expect(
        within(
          screen.getByRole("menu", {
            name: "Revision of the experience matrix",
          }),
        )
          .getAllByRole("menuitemradio")
          .map((each) => each.textContent),
      ).toEqual([
        "Revision 4 · newest",
        "Revision 3 · this session",
        "Revision 2",
        "Revision 1",
      ]);
      fireEvent.click(
        within(
          screen.getByRole("menu", {
            name: "Revision of the experience matrix",
          }),
        ).getByRole("menuitemradio", { name: /^Revision 2$/ }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("pn-context-revision")).toHaveTextContent(
          "Revision 2",
        ),
      );
      expect(served.asked).toContain("profile profile-1 2");
    });
  });

  describe("the experience matrix: ranked roles", () => {
    it("draws the five roles that best match the posting, best first, each with its match", async () => {
      await show();
      expect(screen.getByTestId("pn-context-projection")).toHaveTextContent(
        "Ranked roles",
      );
      expect(artifact("Experience matrix")).toHaveTextContent(
        "The order your roles are tried in.",
      );
      expect(roleIds()).toEqual([
        "/roles/1",
        "/roles/4",
        "/roles/3",
        "/roles/5",
        "/roles/0",
      ]);
      expect(
        roles().map(
          (each) =>
            within(each).getByTestId("pn-context-role-meta").textContent,
        ),
      ).toEqual(["100%", "75%", "50%", "25%", "0%"]);
      expect(roleOf("/roles/1")).toHaveTextContent("Relay Platform");
      expect(roleOf("/roles/1")).toHaveTextContent("Developer · 2021 to 2024");
      // A role with no period says its title alone.
      expect(
        roleOf("/roles/4").querySelector('[data-slot="collapse-description"]'),
      ).toHaveTextContent(/^Developer$/);
    });

    it("Show all draws every role in rank, and Show fewer goes back to five", async () => {
      await show();
      const toggle = () => screen.getByTestId("pn-context-all-roles");
      expect(toggle()).toHaveTextContent("Show all 7");
      fireEvent.click(toggle());
      expect(roleIds()).toEqual([
        "/roles/1",
        "/roles/4",
        "/roles/3",
        "/roles/5",
        "/roles/0",
        "/roles/2",
        "/roles/6",
      ]);
      expect(toggle()).toHaveTextContent("Show fewer");
      fireEvent.click(toggle());
      expect(roles()).toHaveLength(5);
      expect(toggle()).toHaveTextContent("Show all 7");
    });

    it("five roles or fewer are all on show, with nothing to toggle", async () => {
      matrices[4] = { candidate: {}, roles: ROLES.slice(0, 5) };
      await show();
      expect(roles()).toHaveLength(5);
      expect(screen.queryByTestId("pn-context-all-roles")).toBeNull();
    });

    it("marks the roles the notes on show lean on, and no others", async () => {
      await show(session(), [
        noteWith(evidence("Relay"), evidence("x", "/roles/3/proof_points/0")),
      ]);
      const used = roles().filter((each) => each.hasAttribute("data-used"));
      expect(used.map((each) => each.getAttribute("data-role-id"))).toEqual([
        "/roles/1",
        "/roles/3",
      ]);
      for (const each of used) {
        expect(each).toHaveTextContent("In this note");
        // The library Collapse's accent tone: its border and tint.
        expect(each).toHaveAttribute("data-tone", "accent");
      }
      expect(roleOf("/roles/4")).not.toHaveTextContent("In this note");
      expect(roleOf("/roles/4")).toHaveAttribute("data-tone", "default");
    });

    it("a role the notes lean on is on show whatever its rank, in its rank's place", async () => {
      await show(session(), [noteWith(evidence("Stark"))]);
      expect(roleIds()).toEqual([
        "/roles/1",
        "/roles/4",
        "/roles/3",
        "/roles/5",
        "/roles/0",
        "/roles/6",
      ]);
      expect(roleOf("/roles/6")).toHaveAttribute("data-used");
      // One is still left out, so the rest are a toggle away.
      expect(screen.getByTestId("pn-context-all-roles")).toHaveTextContent(
        "Show all 7",
      );
    });

    it("follows the notes it is given: another question's notes mark other roles", async () => {
      const drawn = await show(session(), [noteWith(evidence("Relay"))]);
      expect(roleOf("/roles/1")).toHaveAttribute("data-used");
      drawn.rerender(
        <ContextPane s={session()} notes={[noteWith(evidence("Hooli"))]} />,
      );
      expect(roleOf("/roles/1")).not.toHaveAttribute("data-used");
      expect(roleOf("/roles/4")).toHaveAttribute("data-used");
    });

    it("a role opens to its figures, proof, leadership and stack, and closes again", async () => {
      await show();
      const relay = () => roleOf("/roles/1");
      expect(opener("/roles/1")).toHaveAttribute("aria-expanded", "false");
      // The header is one button that names the employer and the role whole.
      expect(opener("/roles/1")).toHaveTextContent(
        "Relay PlatformDeveloper · 2021 to 2024",
      );
      expect(relay()).not.toHaveTextContent("Moved billing to the outbox");
      fireEvent.click(opener("/roles/1"));
      expect(opener("/roles/1")).toHaveAttribute("aria-expanded", "true");
      expect(relay()).toHaveTextContent(
        "FiguresDeploy time: 40 to 6 minutesServices: 12ProofMoved billing to the outboxCut retries by 40%LeadershipLed a team of sixStackkafka · postgres · react · typescript",
      );
      fireEvent.click(opener("/roles/1"));
      expect(opener("/roles/1")).toHaveAttribute("aria-expanded", "false");
      expect(relay()).not.toHaveTextContent("Moved billing to the outbox");
    });

    it("a role shows only the kinds of fact it has, and each role opens on its own", async () => {
      await show();
      fireEvent.click(opener("/roles/1"));
      fireEvent.click(opener("/roles/4"));
      const hooli = roleOf("/roles/4");
      expect(hooli).toHaveTextContent("Stackkafka · postgres · react · ruby");
      for (const absent of ["Figures", "Proof", "Leadership"])
        expect(hooli).not.toHaveTextContent(absent);
      // Opening one leaves the other open.
      expect(roleOf("/roles/1")).toHaveTextContent("Moved billing");
    });
  });

  describe("the experience matrix: the other ways it is read", () => {
    it("as facts: each role says how many it holds, and opens to each with its address", async () => {
      await show();
      readAs(/^Facts the model can quote$/);
      expect(screen.getByTestId("pn-context-projection")).toHaveTextContent(
        "Facts the model can quote",
      );
      expect(artifact("Experience matrix")).toHaveTextContent(
        "Every piece of text in a role is one source with its own address.",
      );
      // The same roles in the same rank; the match gives way to the count.
      expect(roleIds()[0]).toBe("/roles/1");
      expect(roleOf("/roles/1")).toHaveTextContent("14 facts");
      expect(roleOf("/roles/1")).not.toHaveTextContent("100%");
      expect(roleOf("/roles/4")).toHaveTextContent("6 facts");
      fireEvent.click(opener("/roles/1"));
      const facts = within(roleOf("/roles/1")).getAllByTestId("pn-fact");
      expect(facts).toHaveLength(14);
      expect(facts[0]?.textContent).toBe("/roles/1/company  Relay Platform");
      expect(facts.map((each) => each.textContent)).toContain(
        "/roles/1/metrics/1/value  12",
      );
      expect(facts.map((each) => each.textContent)).toContain(
        "/roles/1/proof_points/1  Cut retries by 40%",
      );
      // Facts are read here, not edited.
      expect(screen.queryByTestId("pn-context-edit-role")).toBeNull();
    });

    it("as stories by need: each need with its story and the one behind it", async () => {
      await show();
      readAs(/^Stories by need$/);
      const matrix = artifact("Experience matrix");
      expect(roles()).toEqual([]);
      expect(screen.queryByTestId("pn-context-all-roles")).toBeNull();
      expect(matrix).toHaveTextContent("ConflictRelay · Hooli");
      expect(matrix).toHaveTextContent("FailureInitech");
      expect(matrix).toHaveTextContent(
        "Which story answers which kind of question.",
      );
    });

    it("by technology: the roles to reach for, and it says when a technology names none", async () => {
      await show();
      readAs(/^By technology$/);
      const matrix = artifact("Experience matrix");
      expect(matrix).toHaveTextContent("KafkaRelay · Umbrella");
      expect(matrix).toHaveTextContent("Rustno roles named");
    });

    it("by industry: says so when the matrix has none", async () => {
      await show();
      readAs(/^By industry$/);
      expect(artifact("Experience matrix")).toHaveTextContent(
        "The matrix has none of these yet.",
      );
      // Back to the roles.
      readAs(/^Ranked roles$/);
      expect(roles()).toHaveLength(5);
    });
  });

  describe("the experience matrix: edited where it stands", () => {
    const edit = () => {
      fireEvent.click(opener("/roles/1"));
      fireEvent.click(
        within(roleOf("/roles/1")).getByTestId("pn-context-edit-role"),
      );
    };
    const field = (label: string) =>
      screen.getByLabelText(
        `${label} for Relay Platform`,
      ) as HTMLTextAreaElement;

    it("a role's proof, leadership and stack are edited a line to an item", async () => {
      await show();
      edit();
      expect(field("Proof").value).toBe(
        "Moved billing to the outbox\nCut retries by 40%",
      );
      expect(field("Leadership").value).toBe("Led a team of six");
      expect(field("Stack").value).toBe("kafka\npostgres\nreact\ntypescript");
      expect(roleOf("/roles/1")).toHaveTextContent("Proof · one per line");
      // The read view gives way to the editor.
      expect(roleOf("/roles/1")).not.toHaveTextContent("Figures");
      expect(screen.queryByTestId("pn-context-edit-role")).toBeNull();
    });

    it("Save writes the whole matrix as the next revision of the same profile, and the pane moves to it", async () => {
      await show();
      edit();
      fireEvent.change(field("Proof"), {
        target: {
          value: "Moved billing to the outbox\n\n  Shipped the relay  ",
        },
      });
      fireEvent.click(screen.getByTestId("pn-context-save-role"));
      await waitFor(() =>
        expect(screen.getByTestId("pn-context-revision")).toHaveTextContent(
          "Revision 5",
        ),
      );
      expect(served.imported).toHaveLength(1);
      const sent = served.imported[0] as Imported;
      expect(sent).toMatchObject({
        name: "Main matrix",
        profileId: "profile-1",
        expectedRevision: 4,
      });
      expect(sent.matrix.roles[1]?.proof_points).toEqual([
        "Moved billing to the outbox",
        "Shipped the relay",
      ]);
      // Nothing else of the matrix is changed by the edit.
      expect(sent.matrix.roles[1]?.metrics).toEqual(ROLES[1]?.metrics);
      expect(sent.matrix.roles[0]).toEqual(ROLES[0]);
      expect(sent.matrix.story_selector).toEqual(MATRIX.story_selector);
      expect(served.asked).toContain("profile profile-1 5");
      await waitFor(() =>
        expect(screen.queryByTestId("pn-context-save-role")).toBeNull(),
      );
      fireEvent.click(opener("/roles/1"));
      expect(roleOf("/roles/1")).toHaveTextContent("Shipped the relay");
      expect(roleOf("/roles/1")).not.toHaveTextContent("Cut retries by 40%");
      // This session still answers from the revision it started with.
      expect(
        within(artifact("Experience matrix")).getByRole("status"),
      ).toHaveTextContent(
        "This session answers from revision 4. Revision 5 is used from the next session.",
      );
    });

    it("Cancel leaves the role as it was and saves nothing", async () => {
      await show();
      edit();
      fireEvent.change(field("Proof"), { target: { value: "Thrown away" } });
      fireEvent.click(
        within(roleOf("/roles/1")).getByRole("button", { name: "Cancel" }),
      );
      expect(served.imported).toEqual([]);
      expect(roleOf("/roles/1")).toHaveTextContent("Cut retries by 40%");
      expect(roleOf("/roles/1")).not.toHaveTextContent("Thrown away");
      expect(
        within(roleOf("/roles/1")).getByTestId("pn-context-edit-role"),
      ).toBeInTheDocument();
    });

    it("a save that is refused says so, keeps the editor open with what was typed, and stays on the revision", async () => {
      served.importProfile = async () => {
        throw new Error("revision conflict");
      };
      await show();
      edit();
      fireEvent.change(field("Proof"), { target: { value: "Still here" } });
      fireEvent.click(screen.getByTestId("pn-context-save-role"));
      expect(
        await screen.findByText(
          "Not saved: the matrix changed elsewhere, or the change is not valid. Reload and try again.",
        ),
      ).toBeInTheDocument();
      expect(field("Proof").value).toBe("Still here");
      expect(screen.getByTestId("pn-context-save-role")).toBeEnabled();
      expect(screen.getByTestId("pn-context-revision")).toHaveTextContent(
        "Revision 4",
      );
    });

    it("only the newest revision is edited: an older one is read, and can be restored as the newest", async () => {
      matrices[2] = { candidate: {}, roles: ROLES.slice(0, 3) };
      await show();
      expect(screen.queryByTestId("pn-context-restore")).toBeNull();
      pick(
        "pn-context-revision",
        "Revision of the experience matrix",
        /^Revision 2$/,
      );
      await waitFor(() => expect(roles()).toHaveLength(3));
      fireEvent.click(opener("/roles/1"));
      expect(roleOf("/roles/1")).toHaveTextContent("Moved billing");
      expect(screen.queryByTestId("pn-context-edit-role")).toBeNull();

      fireEvent.click(screen.getByTestId("pn-context-restore"));
      await waitFor(() =>
        expect(screen.getByTestId("pn-context-revision")).toHaveTextContent(
          "Revision 5",
        ),
      );
      expect(served.imported).toEqual([
        {
          name: "Main matrix",
          matrix: matrices[2],
          profileId: "profile-1",
          expectedRevision: 4,
        },
      ]);
      // The restored one is the newest now: nothing left to restore.
      expect(roles()).toHaveLength(3);
      expect(screen.queryByTestId("pn-context-restore")).toBeNull();
    });
  });

  describe("the job posting and the person's notes", () => {
    const posting = () => artifact("Job posting");
    const editor = () =>
      screen.getByLabelText(
        "Your notes for this interview",
      ) as HTMLTextAreaElement;

    it("says how long each is, and shows the notes", async () => {
      await show();
      expect(posting()).toHaveTextContent(
        `${(CANDIDACY.jobDescription ?? "").length} and ${(CANDIDACY.notes ?? "").length} characters`,
      );
      expect(posting()).toHaveTextContent("Round two is with the CTO.");
      // The posting itself is counted, not printed.
      expect(posting()).not.toHaveTextContent("We run kafka");
    });

    it("cuts notes longer than 900 characters, and keeps 900 whole", async () => {
      served.context = async () => ({ ...CANDIDACY, notes: "n".repeat(901) });
      const drawn = await show();
      expect(posting()).toHaveTextContent(/n{900}…$/);
      expect(posting()).not.toHaveTextContent("n".repeat(901));
      drawn.unmount();
      served.context = async () => ({ ...CANDIDACY, notes: "n".repeat(900) });
      await show();
      expect(posting()).toHaveTextContent(/n{900}$/);
    });

    it("says there are no notes, and counts nothing, when the interview has neither", async () => {
      served.context = async () => ({
        ...CANDIDACY,
        notes: null,
        jobDescription: null,
      });
      await show();
      expect(posting()).toHaveTextContent("0 and 0 characters");
      expect(posting()).toHaveTextContent("No notes for this interview.");
    });

    it("the notes are edited in place, whole however long, and saved with the interview's title and posting", async () => {
      const long = `Round two. ${"n".repeat(1_000)}`;
      served.context = async (_path, init) =>
        init?.method === "PATCH"
          ? { ...CANDIDACY, notes: "Round three is the panel." }
          : { ...CANDIDACY, notes: long };
      await show();
      fireEvent.click(screen.getByTestId("pn-context-edit-notes"));
      expect(editor().value).toBe(long);
      expect(screen.queryByTestId("pn-context-edit-notes")).toBeNull();
      expect(posting()).toHaveTextContent(
        "Saved in place: notes do not keep revisions yet.",
      );
      fireEvent.change(editor(), {
        target: { value: "Round three is the panel." },
      });
      fireEvent.click(screen.getByTestId("pn-context-save-notes"));
      await waitFor(() =>
        expect(screen.queryByTestId("pn-context-save-notes")).toBeNull(),
      );
      expect(served.asked).toContain(
        `PATCH /candidacies/${CANDIDACY.id}/context`,
      );
      expect(served.patched).toEqual([
        {
          title: "Principal",
          jobDescription: CANDIDACY.jobDescription,
          notes: "Round three is the panel.",
        },
      ]);
      expect(posting()).toHaveTextContent("Round three is the panel.");
      expect(notify).not.toHaveBeenCalled();
      expect(screen.getByTestId("pn-context-edit-notes")).toBeInTheDocument();
    });

    it("an interview with no notes and no posting is edited from empty, and saved with an empty posting", async () => {
      served.context = async (_path, init) => ({
        ...CANDIDACY,
        jobDescription: null,
        notes: init?.method === "PATCH" ? "First note" : null,
      });
      await show();
      fireEvent.click(screen.getByTestId("pn-context-edit-notes"));
      expect(editor().value).toBe("");
      fireEvent.change(editor(), { target: { value: "First note" } });
      fireEvent.click(screen.getByTestId("pn-context-save-notes"));
      await waitFor(() => expect(posting()).toHaveTextContent("First note"));
      expect(served.patched).toEqual([
        { title: "Principal", jobDescription: "", notes: "First note" },
      ]);
    });

    it("Cancel leaves the notes as they were and saves nothing", async () => {
      await show();
      fireEvent.click(screen.getByTestId("pn-context-edit-notes"));
      fireEvent.change(editor(), { target: { value: "Thrown away" } });
      fireEvent.click(
        within(posting()).getByRole("button", { name: "Cancel" }),
      );
      expect(served.patched).toEqual([]);
      expect(posting()).toHaveTextContent("Round two is with the CTO.");
      expect(posting()).not.toHaveTextContent("Thrown away");
    });

    it("a save that fails says so, and keeps the editor open with what was typed", async () => {
      served.context = async (_path, init) => {
        if (init?.method === "PATCH") throw new Error("offline");
        return CANDIDACY;
      };
      await show();
      fireEvent.click(screen.getByTestId("pn-context-edit-notes"));
      fireEvent.change(editor(), { target: { value: "Still here" } });
      fireEvent.click(screen.getByTestId("pn-context-save-notes"));
      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          "Your notes were not saved. Try again.",
        ),
      );
      expect(editor().value).toBe("Still here");
      await waitFor(() =>
        expect(screen.getByTestId("pn-context-save-notes")).toBeEnabled(),
      );
    });

    it("there are no notes to edit without an interview", async () => {
      render(<ContextPane s={session(null)} notes={[]} />);
      await waitFor(() => expect(roles().length).toBeGreaterThan(0));
      expect(screen.queryByTestId("pn-context-edit-notes")).toBeNull();
    });
  });

  describe("the experience matrix: selected for this question", () => {
    const QUESTION = "How do you keep Kafka & Postgres consistent?";
    type Selected = ContextView["selected"][number];
    type Excluded = ContextView["excluded"][number];
    const given = (
      slot: string,
      text: string,
      extra: Partial<Selected> = {},
    ): Selected => ({
      id: `${slot}:${text}`,
      pointer: "/roles/1/proof_points/1",
      text,
      kind: "proof",
      about: "candidate",
      slot,
      exact: false,
      ...extra,
    });
    const leftOut = (reason: Excluded["reason"], at: number): Excluded => ({
      id: `left-${reason}-${at}`,
      pointer: `/roles/0/technologies/${at}`,
      text: `left out ${at}`,
      kind: "technology",
      about: "candidate",
      slot: "evidence",
      reason,
    });
    const VIEW: ContextView = {
      projection: "coach",
      spoken: QUESTION,
      terms: "kafka postgres consistent",
      records: 9,
      selected: [
        given("employer.company", "Northwind", {
          about: "employer",
          pointer: "brief:company",
          exact: true,
        }),
        given("evidence", "Cut retries by 40%"),
        given("requirements", "Postgres at scale", {
          about: "employer",
          pointer: "brief:mustHaves/1",
        }),
        // A second fact of a slot already drawn joins that slot's block.
        given("evidence", "Moved billing to the outbox", {
          pointer: "/roles/1/proof_points/0",
        }),
        given("preferences", "Remote first", {
          about: "preference",
          pointer: "/candidate/preferences/0",
        }),
      ],
      excluded: [
        leftOut("relevance", 0),
        leftOut("limit", 1),
        leftOut("relevance", 2),
        leftOut("budget", 3),
      ],
      slots: [{ slot: "evidence", state: "covered", count: 2 }],
      digest: "0".repeat(64),
      sources: [{ id: "profile-1", revision: "4" }],
    };
    // A session that has started: the selection is read for its id.
    const started = (id = "session-1") =>
      ({
        model: { candidacyId: CANDIDACY.id },
        session: { id, profile: PINNED },
        notify,
      }) as unknown as PanelSession;
    const answer = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    // The selection's server: answers each read as the test says, and refuses
    // one that was aborted the way the browser does.
    type Read = { url: URL; init: RequestInit };
    let reads: Read[] = [];
    function serve(reply: (read: Read) => Promise<Response> | Response) {
      reads = [];
      return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const read = {
          url: new URL(String(input), "http://studio.test"),
          init: init ?? {},
        };
        reads.push(read);
        const signal = read.init.signal;
        return new Promise<Response>((resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          Promise.resolve(reply(read)).then(resolve, reject);
        });
      });
    }
    const selectedFor = () => screen.getByTestId("pn-context-selected-for");
    const slots = () => screen.queryAllByTestId("pn-context-slot");
    const NOTHING = "Nothing in your material is about this question.";
    const READING = "Reading the selection…";
    const FAILED = "The selection could not be read for this session.";
    async function showSelected(question: string | undefined, s = started()) {
      const drawn = render(
        <ContextPane
          s={s}
          notes={[]}
          {...(question === undefined ? {} : { question })}
        />,
      );
      await waitFor(() => expect(roles().length).toBeGreaterThan(0));
      await screen.findByText("Northwind · Principal");
      readAs(/^Selected for this question$/);
      return drawn;
    }

    it("is the last way the matrix is read, says how the coach uses it, and takes the roles' place", async () => {
      serve(() => answer({ view: VIEW }));
      await showSelected(QUESTION);
      expect(screen.getByTestId("pn-context-projection")).toHaveTextContent(
        "Selected for this question",
      );
      expect(artifact("Experience matrix")).toHaveTextContent(
        "Exactly what the coach is given for the question on show",
      );
      expect(roles()).toEqual([]);
      expect(screen.queryByTestId("pn-context-all-roles")).toBeNull();
      await waitFor(() => expect(slots().length).toBeGreaterThan(0));
    });

    it("nothing is read until it is chosen", async () => {
      const fetched = serve(() => answer({ view: VIEW }));
      render(<ContextPane s={started()} notes={[]} question={QUESTION} />);
      await waitFor(() => expect(roles().length).toBeGreaterThan(0));
      readAs(/^Facts the model can quote$/);
      expect(fetched).not.toHaveBeenCalled();
      expect(screen.queryByTestId("pn-context-selected-for")).toBeNull();
    });

    it("asks the session's context for the coach projection of the question, written into the address safely", async () => {
      serve(() => answer({ view: VIEW }));
      await showSelected(QUESTION, started("s/1 a"));
      await waitFor(() => expect(slots().length).toBeGreaterThan(0));
      expect(reads).toHaveLength(1);
      const [read] = reads as [Read];
      expect(`${read.url.pathname}${read.url.search}`).toBe(
        "/api/interview/t/local/sessions/s%2F1%20a/context?projection=coach&q=How+do+you+keep+Kafka+%26+Postgres+consistent%3F",
      );
      expect([...read.url.searchParams]).toEqual([
        ["projection", "coach"],
        ["q", QUESTION],
      ]);
      expect(read.init.method ?? "GET").toBe("GET");
      expect(read.init.signal).toBeInstanceOf(AbortSignal);
    });

    it("names the tenant the page belongs to, in the address and to the host", async () => {
      const before = window.location.pathname;
      window.history.pushState({}, "", "/t/acme%20co/p/interview");
      try {
        serve(() => answer({ view: VIEW }));
        await showSelected(QUESTION);
        await waitFor(() => expect(reads).toHaveLength(1));
        expect(reads[0]?.url.pathname).toBe(
          "/api/interview/t/acme%20co/sessions/session-1/context",
        );
        expect(
          new Headers(reads[0]?.init.headers).get("x-omnitech-tenant"),
        ).toBe("acme co");
      } finally {
        window.history.pushState({}, "", before);
      }
    });

    it("says what it was selected for and the words that matched", async () => {
      serve(() => answer({ view: VIEW }));
      await showSelected(QUESTION);
      await waitFor(() =>
        expect(selectedFor().textContent).toBe(
          `For: “${QUESTION}” Matched on: kafka postgres consistent.`,
        ),
      );
    });

    it("draws one block a slot in the order the model is given them, each fact with whose it is and its address", async () => {
      serve(() => answer({ view: VIEW }));
      await showSelected(QUESTION);
      await waitFor(() => expect(slots()).toHaveLength(4));
      // A pointer that is not an address in the matrix ("brief:…") is not drawn.
      expect(slots().map((each) => each.textContent)).toEqual([
        "CompanyNorthwindTheirs",
        "Your evidenceCut retries by 40%Yours/roles/1/proof_points/1Moved billing to the outboxYours/roles/1/proof_points/0",
        "What they requirePostgres at scaleTheirs",
        "Your preferencesRemote firstYour preference/candidate/preferences/0",
      ]);
      expect(artifact("Experience matrix")).not.toHaveTextContent("brief:");
      // Something of the person's own was selected.
      expect(screen.queryByText(NOTHING)).toBeNull();
    });

    it.each([
      ["candidate.name", "Name"],
      ["candidate.headline", "Headline"],
      ["candidate.location", "Location"],
      ["employer.role", "Role"],
      ["stories", "Your story for this"],
      ["roles", "Your roles"],
      ["employer", "About them"],
      ["prep", "Your prep"],
      // A slot the pane has no name for is named as the server names it.
      ["benefits", "benefits"],
    ])("the slot %s is labelled %s", async (slot, label) => {
      serve(() =>
        answer({ view: { ...VIEW, selected: [given(slot, "A fact")] } }),
      );
      await showSelected(QUESTION);
      await waitFor(() => expect(slots()).toHaveLength(1));
      expect(slots()[0]?.textContent).toBe(
        `${label}A factYours/roles/1/proof_points/1`,
      );
    });

    it("says how many facts were given of how many, and what was left out by reason", async () => {
      serve(() => answer({ view: VIEW }));
      await showSelected(QUESTION);
      expect(
        (await screen.findByTestId("pn-context-left-out")).textContent,
      ).toBe(
        "5 of 9 facts given. Left out: 2 not about this question, 1 more than the note can use, 1 no room left.",
      );
    });

    it("names every reason a fact is left out, twelve of one as twelve", async () => {
      serve(() =>
        answer({
          view: {
            ...VIEW,
            records: 19,
            excluded: [
              ...Array.from({ length: 12 }, (_, at) =>
                leftOut("relevance", at),
              ),
              leftOut("over-limit", 12),
              leftOut("excluded", 13),
            ],
          },
        }),
      );
      await showSelected(QUESTION);
      expect(
        (await screen.findByTestId("pn-context-left-out")).textContent,
      ).toBe(
        "5 of 19 facts given. Left out: 12 not about this question, 1 too long to give whole, 1 excluded by you.",
      );
    });

    it("with nothing left out it says only how many were given", async () => {
      serve(() => answer({ view: { ...VIEW, records: 5, excluded: [] } }));
      await showSelected(QUESTION);
      expect(
        (await screen.findByTestId("pn-context-left-out")).textContent,
      ).toBe("5 of 5 facts given.");
    });

    it("says nothing in the material is about the question when only exact facts were selected", async () => {
      serve(() =>
        answer({
          view: {
            ...VIEW,
            terms: "",
            selected: [
              given("employer.company", "Northwind", {
                about: "employer",
                pointer: "brief:company",
                exact: true,
              }),
              given("candidate.name", "Sam Example", {
                pointer: "/candidate/name",
                exact: true,
              }),
            ],
          },
        }),
      );
      await showSelected(QUESTION);
      expect(await screen.findByText(NOTHING)).toBeInTheDocument();
      // The exact facts are still drawn, and no words are said to have matched.
      expect(slots().map((each) => each.textContent)).toEqual([
        "CompanyNorthwindTheirs",
        "NameSam ExampleYours/candidate/name",
      ]);
      expect(selectedFor().textContent).toBe(`For: “${QUESTION}”`);
      expect(screen.getByTestId("pn-context-left-out")).toHaveTextContent(
        "2 of 9 facts given.",
      );
    });

    it("says the same when nothing at all was selected", async () => {
      serve(() => answer({ view: { ...VIEW, selected: [] } }));
      await showSelected(QUESTION);
      expect(await screen.findByText(NOTHING)).toBeInTheDocument();
      expect(slots()).toEqual([]);
      expect(screen.getByTestId("pn-context-left-out")).toHaveTextContent(
        "0 of 9 facts given.",
      );
    });

    it("with no question on show it asks with an empty one, and says the facts were chosen by importance", async () => {
      serve(() => answer({ view: { ...VIEW, spoken: "", terms: "" } }));
      await showSelected(undefined);
      await waitFor(() =>
        expect(selectedFor().textContent).toBe(
          "No question on show: chosen by importance alone.",
        ),
      );
      expect(reads[0]?.url.search).toBe("?projection=coach&q=");
    });

    it("with no session it says to start one, and reads nothing", async () => {
      const fetched = serve(() => answer({ view: VIEW }));
      await showSelected(QUESTION, session());
      expect(
        screen.getByText(
          "Start a session to see what is selected for each question.",
        ),
      ).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fetched).not.toHaveBeenCalled();
      expect(screen.queryByText(READING)).toBeNull();
      expect(screen.queryByTestId("pn-context-selected-for")).toBeNull();
      expect(screen.queryByTestId("pn-context-left-out")).toBeNull();
    });

    it("says it is reading until the selection lands", async () => {
      let land: (response: Response) => void = () => undefined;
      serve(
        () =>
          new Promise<Response>((resolve) => {
            land = resolve;
          }),
      );
      await showSelected(QUESTION);
      expect(screen.getByText(READING)).toBeInTheDocument();
      expect(slots()).toEqual([]);
      expect(screen.queryByTestId("pn-context-left-out")).toBeNull();
      land(answer({ view: VIEW }));
      await waitFor(() => expect(slots()).toHaveLength(4));
      expect(screen.queryByText(READING)).toBeNull();
    });

    it.each([
      ["the server refuses it", () => answer({ error: "not found" }, 404)],
      ["the server fails", () => answer({ view: VIEW }, 500)],
      [
        "the network is down",
        () => Promise.reject(new TypeError("Failed to fetch")),
      ],
      [
        "what comes back is not a view",
        () => answer({ view: { ...VIEW, projection: "debug" } }),
      ],
      ["what comes back is not JSON", () => new Response("<html>")],
    ])("says the selection could not be read when %s", async (_why, reply) => {
      serve(reply);
      await showSelected(QUESTION);
      const said = await screen.findByText(FAILED);
      expect(said).toHaveAttribute("role", "status");
      expect(screen.queryByText(READING)).toBeNull();
      expect(slots()).toEqual([]);
      expect(screen.queryByTestId("pn-context-left-out")).toBeNull();
      // The rest of the pane stands.
      expect(artifact("Interview brief")).toHaveTextContent(
        "Northwind · Principal",
      );
    });

    it("reads again when the question changes, and gives up the earlier read", async () => {
      const NEXT = "Tell me about a failure.";
      const landing: ((response: Response) => void)[] = [];
      serve(
        () =>
          new Promise<Response>((resolve) => {
            landing.push(resolve);
          }),
      );
      const drawn = await showSelected(QUESTION);
      expect(reads).toHaveLength(1);
      drawn.rerender(<ContextPane s={started()} notes={[]} question={NEXT} />);
      await waitFor(() => expect(reads).toHaveLength(2));
      expect(reads[0]?.init.signal?.aborted).toBe(true);
      expect(reads[1]?.init.signal?.aborted).toBe(false);
      expect(reads[1]?.url.searchParams.get("q")).toBe(NEXT);
      // Giving up a read is not a failure to read.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(screen.queryByText(FAILED)).toBeNull();
      expect(screen.getByText(READING)).toBeInTheDocument();
      landing[1]?.(
        answer({
          view: {
            ...VIEW,
            terms: "failure",
            selected: [given("stories", "The Initech outage")],
          },
        }),
      );
      await waitFor(() =>
        expect(selectedFor().textContent).toBe(
          `For: “${NEXT}” Matched on: failure.`,
        ),
      );
      expect(slots().map((each) => each.textContent)).toEqual([
        "Your story for thisThe Initech outageYours/roles/1/proof_points/1",
      ]);
    });

    it("the earlier question's selection is not left on show while the next is read", async () => {
      let hold = false;
      serve(() =>
        hold ? new Promise<Response>(() => undefined) : answer({ view: VIEW }),
      );
      const drawn = await showSelected(QUESTION);
      await waitFor(() => expect(slots()).toHaveLength(4));
      hold = true;
      drawn.rerender(
        <ContextPane s={started()} notes={[]} question="Why Northwind?" />,
      );
      await waitFor(() => expect(reads).toHaveLength(2));
      expect(slots()).toEqual([]);
      expect(screen.queryByTestId("pn-context-selected-for")).toBeNull();
      expect(screen.getByText(READING)).toBeInTheDocument();
    });

    it("a failed read does not outlast its question: the next one is read and drawn", async () => {
      let fail = true;
      serve(() =>
        fail ? answer({ error: "offline" }, 503) : answer({ view: VIEW }),
      );
      const drawn = await showSelected(QUESTION);
      await screen.findByText(FAILED);
      fail = false;
      drawn.rerender(
        <ContextPane s={started()} notes={[]} question="Why Northwind?" />,
      );
      await waitFor(() => expect(slots()).toHaveLength(4));
      expect(screen.queryByText(FAILED)).toBeNull();
    });

    it("the same question drawn again is not read again", async () => {
      serve(() => answer({ view: VIEW }));
      const drawn = await showSelected(QUESTION);
      await waitFor(() => expect(slots()).toHaveLength(4));
      drawn.rerender(
        <ContextPane s={started()} notes={[]} question={QUESTION} />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(reads).toHaveLength(1);
      expect(slots()).toHaveLength(4);
    });

    it("another session's selection is read in the first one's place", async () => {
      serve(() => answer({ view: VIEW }));
      const drawn = await showSelected(QUESTION);
      await waitFor(() => expect(slots()).toHaveLength(4));
      drawn.rerender(
        <ContextPane s={started("session-2")} notes={[]} question={QUESTION} />,
      );
      await waitFor(() => expect(reads).toHaveLength(2));
      expect(reads[1]?.url.pathname).toBe(
        "/api/interview/t/local/sessions/session-2/context",
      );
    });

    it("reading the matrix another way gives up the read, and coming back reads again", async () => {
      serve(() => new Promise<Response>(() => undefined));
      await showSelected(QUESTION);
      expect(reads).toHaveLength(1);
      readAs(/^Ranked roles$/);
      expect(reads[0]?.init.signal?.aborted).toBe(true);
      expect(roles()).toHaveLength(5);
      expect(screen.queryByText(READING)).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(screen.queryByText(FAILED)).toBeNull();
      readAs(/^Selected for this question$/);
      await waitFor(() => expect(reads).toHaveLength(2));
      expect(screen.getByText(READING)).toBeInTheDocument();
    });

    // [DOMAIN] The stage the selection is resolved for: the session's own
    // until the person picks another by its place, or every stage.
    describe("the stage it is selected for", () => {
      const STAGES = [
        {
          id: "33333333-3333-4333-8333-333333333331",
          ordinal: 1,
          label: "Hiring manager",
          kind: "hiring_manager",
        },
        {
          id: "33333333-3333-4333-8333-333333333332",
          ordinal: 2,
          label: "Technical",
          kind: "technical",
        },
      ];
      const staged = (stage: (typeof STAGES)[number] | null): ContextView => ({
        ...VIEW,
        selected: [
          given("prep", "Live coding plan: read the tests first", {
            about: "employer",
            pointer: "/stages/x/notes/1",
            stage: 2,
          }),
          given("prep", "Rota onboarding: shadow first", {
            about: "employer",
            pointer: "/stages/y/notes/1",
            stage: 1,
          }),
          given("evidence", "Cut retries by 40%"),
        ],
        excluded: [
          { ...leftOut("scope", 0), slot: "prep", stage: 2 },
          leftOut("relevance", 1),
        ],
        stage,
        stages: STAGES,
      });
      const pickStage = (label: RegExp) =>
        pick("pn-context-stage", "The stage this is selected for", label);

      it("offers no stage to pick for an application without stages", async () => {
        const fetched = serve(() => answer({ view: VIEW }));
        try {
          await showSelected(QUESTION);
          await waitFor(() => expect(slots().length).toBeGreaterThan(0));
          expect(screen.queryByTestId("pn-context-stage")).toBeNull();
          expect(reads[0]?.url.searchParams.has("stage")).toBe(false);
        } finally {
          fetched.mockRestore();
        }
      });

      it("says the stage the session was started for, marks each fact with its stage, and counts what a later stage holds", async () => {
        const fetched = serve(() =>
          answer({ view: staged(STAGES[1] ?? null) }),
        );
        try {
          await showSelected(QUESTION);
          await waitFor(() => expect(slots().length).toBeGreaterThan(0));
          expect(screen.getByTestId("pn-context-stage")).toHaveTextContent(
            "Stage 2: Technical",
          );
          // Nothing was asked for: the server chose the session's own stage.
          expect(reads[0]?.url.searchParams.has("stage")).toBe(false);
          const prep = slots().find((slot) =>
            slot.textContent?.includes("Live coding plan"),
          );
          expect(prep?.textContent).toMatch(
            /Live coding plan: read the tests first.*Stage 2.*Rota onboarding: shadow first.*Stage 1/s,
          );
          // A fact of no stage carries no stage.
          const evidence = slots().find((slot) =>
            slot.textContent?.includes("Cut retries"),
          );
          expect(evidence?.textContent).not.toMatch(/Stage \d/);
          expect(screen.getByTestId("pn-context-left-out")).toHaveTextContent(
            "1 belongs to a later stage",
          );
        } finally {
          fetched.mockRestore();
        }
      });

      it("reads the selection again for the stage picked, and for every stage", async () => {
        const fetched = serve(({ url }) => {
          const wanted = url.searchParams.get("stage");
          return answer({
            view: staged(
              wanted === "all"
                ? null
                : ((wanted === "1" ? STAGES[0] : STAGES[1]) ?? null),
            ),
          });
        });
        try {
          await showSelected(QUESTION);
          await waitFor(() =>
            expect(screen.getByTestId("pn-context-stage")).toHaveTextContent(
              "Stage 2: Technical",
            ),
          );
          pickStage(/^1\. Hiring manager$/);
          await waitFor(() =>
            expect(screen.getByTestId("pn-context-stage")).toHaveTextContent(
              "Stage 1: Hiring manager",
            ),
          );
          expect(reads).toHaveLength(2);
          expect([...(reads[1]?.url.searchParams ?? [])]).toEqual([
            ["projection", "coach"],
            ["q", QUESTION],
            ["stage", "1"],
          ]);
          pickStage(/^Every stage$/);
          await waitFor(() =>
            expect(screen.getByTestId("pn-context-stage")).toHaveTextContent(
              /^Every stage$/,
            ),
          );
          expect(reads[2]?.url.searchParams.get("stage")).toBe("all");
        } finally {
          fetched.mockRestore();
        }
      });

      it("goes back to the session's own stage for another session", async () => {
        const fetched = serve(() =>
          answer({ view: staged(STAGES[1] ?? null) }),
        );
        try {
          const drawn = await showSelected(QUESTION);
          await waitFor(() => expect(slots().length).toBeGreaterThan(0));
          pickStage(/^1\. Hiring manager$/);
          await waitFor(() => expect(reads).toHaveLength(2));
          drawn.rerender(
            <ContextPane
              s={started("session-2")}
              notes={[]}
              question={QUESTION}
            />,
          );
          await waitFor(() =>
            expect(reads.at(-1)?.url.pathname).toContain(
              "/sessions/session-2/",
            ),
          );
          expect(reads.at(-1)?.url.searchParams.has("stage")).toBe(false);
        } finally {
          fetched.mockRestore();
        }
      });
    });

    it("a read still under way when the pane goes is given up, and raises nothing", async () => {
      serve(() => new Promise<Response>(() => undefined));
      const errors = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const drawn = await showSelected(QUESTION);
      drawn.unmount();
      expect(reads[0]?.init.signal?.aborted).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(errors).not.toHaveBeenCalled();
    });
  });

  it("a reading that lands after the pane is gone changes nothing and raises nothing", async () => {
    let land: (value: unknown) => void = () => undefined;
    served.context = () =>
      new Promise((resolve) => {
        land = resolve;
      });
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const drawn = render(<ContextPane s={session()} notes={[]} />);
    await waitFor(() => expect(roles().length).toBeGreaterThan(0));
    drawn.unmount();
    land(CANDIDACY);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errors).not.toHaveBeenCalled();
  });
});
