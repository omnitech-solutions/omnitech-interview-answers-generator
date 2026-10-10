import { createBriefingClient } from "@omnitech/interview-api-client";
import type {
  BriefingQuestion,
  CandidateMatrix,
} from "@omnitech/interview-contracts";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswersTab } from "./answers-tab";
import {
  defaultProfile,
  MatrixPicker,
  readDefaultMatrix,
} from "./matrix-picker";
import { QuestionsCard } from "./questions-card";
import { contextOf, emptySetup } from "./setup-card";

vi.mock("../../../markdown-content", () => ({
  MarkdownContent: ({ children }: { children: string }) => children,
}));

const matrix: CandidateMatrix = {
  candidate: { name: "Sam" },
  roles: [
    {
      company: "Relay",
      title: "Engineer",
      period: "2021–2024",
      technologies: ["TypeScript"],
    },
  ],
};
const profiles = [
  {
    id: "local-experience-matrix",
    name: "My matrix",
    revision: 3,
    updatedAt: "2026-10-01T00:00:00Z",
  },
  {
    id: "lead",
    name: "Leadership matrix",
    revision: 1,
    updatedAt: "2026-10-02T00:00:00Z",
  },
];

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("behavioural question editing", () => {
  function editor(initial: string[], canDraft = true) {
    const onChange = vi.fn();
    const onReset = vi.fn();
    const onDraft = vi.fn();
    function Editor() {
      const [questions, setQuestions] = useState(initial);
      return (
        <QuestionsCard
          questions={questions}
          stageLabel="Recruiter screen"
          note="Prepare"
          canDraft={canDraft}
          onChange={(next) => {
            onChange(next);
            setQuestions(next);
          }}
          onReset={onReset}
          onDraft={onDraft}
        />
      );
    }
    render(<Editor />);
    return { onChange, onReset, onDraft };
  }

  it("ignores blank additions and trims a new question", () => {
    const actions = editor(["Tell me about yourself."]);
    const add = screen.getByRole("textbox", { name: "Add a question" });
    fireEvent.change(add, { target: { value: "   " } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(actions.onChange).not.toHaveBeenCalled();
    fireEvent.change(add, { target: { value: "  When could you start?  " } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(actions.onChange).toHaveBeenCalledWith([
      "Tell me about yourself.",
      "When could you start?",
    ]);
    expect(screen.getByRole("textbox", { name: "Question 2" })).toHaveValue(
      "When could you start?",
    );
    expect(add).toHaveValue("");
    expect(screen.getByText("Logistics")).toBeVisible();
  });

  it("caps a pack at twenty questions and allows adding after one is removed", () => {
    const questions = Array.from(
      { length: 20 },
      (_, index) => `Question ${index + 1}?`,
    );
    const actions = editor(questions);
    const add = screen.getByRole("textbox", { name: "Add a question" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("placeholder", "A pack holds 20 questions");
    fireEvent.keyDown(add, { key: "Enter" });
    expect(actions.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove question 2" }));
    expect(actions.onChange).toHaveBeenCalledWith(
      questions.filter((_, index) => index !== 1),
    );
    expect(add).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Question 2" })).toHaveValue(
      "Question 3?",
    );
  });

  it("edits a question, resets suggestions and delegates drafting", () => {
    const actions = editor(["Why this company?"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Question 1" }), {
      target: { value: "What motivates you?" },
    });
    expect(actions.onChange).toHaveBeenCalledWith(["What motivates you?"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(actions.onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Draft answers" }));
    expect(actions.onDraft).toHaveBeenCalledTimes(1);
  });

  it("does not draft when the context is unavailable", () => {
    const actions = editor(["Why this company?"], false);
    const draft = screen.getByRole("button", { name: "Draft answers" });
    expect(draft).toBeDisabled();
    fireEvent.click(draft);
    expect(actions.onDraft).not.toHaveBeenCalled();
  });
});

describe("matrix selection and import", () => {
  function picker(
    fetcher = vi.fn(async () =>
      Response.json({
        id: "imported",
        name: "Sam’s matrix",
        revision: 1,
        sha256: "a".repeat(64),
      }),
    ),
  ) {
    const onChange = vi.fn();
    const onImported = vi.fn();
    render(
      <MatrixPicker
        client={createBriefingClient({ baseUrl: "", fetch: fetcher })}
        profiles={profiles}
        value={{ id: "local-experience-matrix", revision: 3 }}
        matrix={matrix}
        onChange={onChange}
        onImported={onImported}
      />,
    );
    return { fetcher, onChange, onImported };
  }
  function importDialog() {
    fireEvent.click(screen.getByRole("button", { name: /My matrix/ }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Import from JSON…" }),
    );
    return within(
      screen.getByRole("dialog", { name: "Import an experience matrix" }),
    );
  }

  it("uses a stored default, then the built-in matrix, then the first available profile", () => {
    expect(readDefaultMatrix()).toBe("local-experience-matrix");
    localStorage.setItem("omnitech.interview.default-matrix", "lead");
    expect(defaultProfile(profiles)).toEqual({ id: "lead", revision: 1 });
    localStorage.setItem("omnitech.interview.default-matrix", "gone");
    expect(defaultProfile(profiles)).toEqual({
      id: "local-experience-matrix",
      revision: 3,
    });
    expect(defaultProfile(profiles.slice(1))).toEqual({
      id: "lead",
      revision: 1,
    });
    expect(defaultProfile([])).toBeNull();
  });

  it("falls back when browser storage is unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    expect(readDefaultMatrix()).toBe("local-experience-matrix");
  });

  it("marks the current matrix and closes the menu after switching", () => {
    const actions = picker();
    fireEvent.click(screen.getByRole("button", { name: /My matrix/ }));
    expect(
      screen.getByRole("menuitemradio", { name: /My matrix/ }),
    ).toHaveAttribute("aria-checked", "true");
    const lead = screen.getByRole("menuitemradio", {
      name: /Leadership matrix/,
    });
    expect(lead).toHaveAttribute("aria-checked", "false");
    fireEvent.click(lead);
    expect(actions.onChange).toHaveBeenCalledWith({ id: "lead", revision: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(actions.fetcher).not.toHaveBeenCalled();
  });

  it("rejects syntactically valid JSON that is not an experience matrix", () => {
    const actions = picker();
    const dialog = importDialog();
    fireEvent.change(dialog.getByRole("textbox", { name: "Matrix JSON" }), {
      target: { value: '{"roles":[]}' },
    });
    expect(dialog.getByRole("alert")).toHaveTextContent(
      "it needs a candidate and a roles list",
    );
    const submit = dialog.getByRole("button", { name: "Import matrix" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(actions.fetcher).not.toHaveBeenCalled();
    expect(actions.onImported).not.toHaveBeenCalled();
  });

  it("shows an import error and leaves the valid matrix available to retry", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { code: "import-failed" } }, { status: 500 }),
    );
    const actions = picker(fetcher);
    const dialog = importDialog();
    fireEvent.change(dialog.getByRole("textbox", { name: "Matrix JSON" }), {
      target: { value: JSON.stringify(matrix) },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Import matrix" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "API request failed with HTTP 500.",
    );
    expect(dialog.getByRole("button", { name: "Import matrix" })).toBeEnabled();
    expect(dialog.getByRole("textbox", { name: "Matrix JSON" })).toHaveValue(
      JSON.stringify(matrix),
    );
    expect(actions.onImported).not.toHaveBeenCalled();
    expect(
      localStorage.getItem("omnitech.interview.default-matrix"),
    ).toBeNull();
    fetcher.mockResolvedValue(
      Response.json({
        id: "imported",
        name: "Sam’s matrix",
        revision: 1,
        sha256: "a".repeat(64),
      }),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Import matrix" }));
    await waitFor(() =>
      expect(actions.onImported).toHaveBeenCalledWith({
        id: "imported",
        revision: 1,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("behavioural setup payload", () => {
  const setup = () => ({
    ...emptySetup({ id: "lead", revision: 1 }),
    company: " Northwind ",
    role: " Tech Lead ",
  });

  it("requires a matrix, company and role", () => {
    for (const missing of [{ profile: null }, { company: " " }, { role: " " }])
      expect(contextOf({ ...setup(), ...missing })).toBeNull();
  });

  it("trims optional values and preserves the previous request and preferences", () => {
    const previous = {
      company: "Northwind",
      role: "Tech Lead",
      stage: "recruiter" as const,
      profile: { id: "lead", revision: 1 },
      request: "Prepare me.",
      candidatePreferences: "Be concise.",
    };
    expect(
      contextOf(
        {
          ...setup(),
          interviewer: " Sam ",
          interviewerTitle: " Recruiter ",
          research: " Research ",
          jobDescription: " Posting ",
          roleIds: ["/roles/0"],
        },
        previous,
      ),
    ).toEqual({
      ...previous,
      durationMinutes: 30,
      interviewer: "Sam",
      interviewerTitle: "Recruiter",
      research: "Research",
      jobDescription: "Posting",
      roleIds: ["/roles/0"],
    });
  });

  it.each(["", "not a number", "4", "481"])(
    "omits an invalid duration %s and blank optional values",
    (duration) => {
      expect(
        contextOf({
          ...setup(),
          duration,
          interviewer: " ",
          interviewerTitle: " ",
          research: " ",
          jobDescription: " ",
        }),
      ).toEqual({
        company: "Northwind",
        role: "Tech Lead",
        stage: "recruiter",
        profile: { id: "lead", revision: 1 },
      });
    },
  );

  it.each(["5", "480"])(
    "retains a duration at the valid bound %s",
    (duration) => {
      expect(contextOf({ ...setup(), duration })).toMatchObject({
        durationMinutes: Number(duration),
      });
    },
  );
});

const answer: BriefingQuestion = {
  id: "q1",
  question: "A project you are proud of?",
  category: "background",
  answerMarkdown: "My own words.",
  talkingPoints: ["One", "Two", "Three"],
  gaps: ["Check the date"],
  evidenceRefs: [
    {
      id: "lead",
      revision: 1,
      sha256: "a".repeat(64),
      pointer: "/roles/0/technologies/0",
      quote: "TypeScript",
      sourceKind: "candidate",
    },
    {
      id: "lead",
      revision: 1,
      sha256: "a".repeat(64),
      pointer: "/roles/0/title",
      quote: "TypeScript",
      sourceKind: "candidate",
    },
  ],
};

describe("behavioural answer controls", () => {
  function answers(rest: Partial<Parameters<typeof AnswersTab>[0]> = {}) {
    const props = {
      answers: [answer],
      pending: [],
      matrix,
      redrafting: null,
      focus: null,
      onAccept: vi.fn(),
      onAcceptAll: vi.fn(),
      onRedraft: vi.fn(),
      onEdit: vi.fn(),
      onChangeQuestions: vi.fn(),
      ...rest,
    };
    const result = render(<AnswersTab {...props} />);
    return { ...result, props };
  }

  it("shows talking points and gaps and opens deduplicated source quotes", () => {
    answers();
    expect(
      within(screen.getByRole("list", { name: "Talking points" }))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["One", "Two", "Three"]);
    expect(
      screen.getByRole("list", { name: "Check before using" }),
    ).toHaveTextContent("Check the date");
    const source = screen.getByRole("button", { name: "Relay" });
    expect(source).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(source);
    expect(source).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Engineer · 2021–2024")).toBeVisible();
    expect(screen.getAllByText("TypeScript")).toHaveLength(1);
    fireEvent.click(source);
    expect(screen.queryByText("TypeScript")).toBeNull();
    expect(source).toHaveAttribute("aria-pressed", "false");
  });

  it("rejects a blank answer edit and trims the saved answer", () => {
    const { props } = answers();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const field = screen.getByRole("textbox", { name: "Answer" });
    fireEvent.change(field, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "  New words.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onEdit).toHaveBeenCalledWith("q1", "New words.");
    expect(screen.queryByRole("textbox", { name: "Answer" })).toBeNull();
  });

  it("disables redraft, edit and acceptance while redrafting", () => {
    const { props } = answers({ redrafting: "q1" });
    for (const name of ["New draft", "Edit", "Accept"]) {
      const control = screen.getByRole("button", { name });
      expect(control).toBeDisabled();
      fireEvent.click(control);
    }
    expect(props.onRedraft).not.toHaveBeenCalled();
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Answer" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /A project you are proud/ }),
    ).toHaveTextContent("Drafting a new version…");
  });

  it("disables Accept all when every answer is accepted or there are none", () => {
    const { props, rerender } = answers({
      answers: [{ ...answer, accepted: true }],
    });
    expect(screen.getByRole("button", { name: "Accept all" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(props.onAccept).toHaveBeenCalledWith("q1", false);
    rerender(<AnswersTab {...props} answers={[]} />);
    expect(screen.getByRole("button", { name: "Accept all" })).toBeDisabled();
  });

  it("opens the focused answer and falls back to the first if that answer is removed", () => {
    const second = {
      ...answer,
      id: "q2",
      question: "Why Northwind?",
      answerMarkdown: "A second answer.",
    };
    const { props, rerender } = answers({
      answers: [answer, second],
      focus: "q2",
    });
    expect(
      screen.getByRole("button", { name: /Why Northwind/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /A project you are proud/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("A second answer.")).toBeVisible();
    rerender(<AnswersTab {...props} answers={[answer]} />);
    expect(
      screen.getByRole("button", { name: /A project you are proud/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("My own words.")).toBeVisible();
  });
});
